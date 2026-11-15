from __future__ import annotations

import importlib.util
import json
import os
import pty
import select
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
PROVIDERS_DIR = SCRIPTS_DIR.parent / 'providers'
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
if str(SCRIPTS_DIR.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR.parent))

import main  # noqa: E402
from commands.lifecycle import default_dsh_state_file, uses_native_enter  # noqa: E402
from providers import (  # noqa: E402
    get_agents_md_mode,
    get_mcp_config_mode,
    get_prompt_patterns,
    get_provider_key,
    get_session_restore_mode,
    get_system_prompt_flag,
    get_system_prompt_mode,
    resolve_launcher_command,
)


def _load_repl_module():
    spec = importlib.util.spec_from_file_location('dsh_repl_test', PROVIDERS_DIR / 'dsh_repl.py')
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


dsh_repl = _load_repl_module()


FAKE_DSH = '''#!/usr/bin/env python3
import json
import os
import sys

payload = sys.stdin.read()
with open(os.environ['FAKE_DSH_LOG'], 'a', encoding='utf-8') as handle:
    handle.write(json.dumps({
        'argv': sys.argv[1:], 'payload': payload,
        'permission_mode': os.environ.get('DSH_PERMISSION_MODE'),
    }) + '\\n')
print(json.dumps({'type': 'session/start', 'sessionId': 'fake-dsh-session'}), flush=True)
print(json.dumps({'type': 'assistant.text', 'text': 'fake reply'}), flush=True)
'''


def _read_until(fd: int, expected: str, timeout: float = 8.0) -> str:
    deadline = time.monotonic() + timeout
    collected = b''
    while time.monotonic() < deadline:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        collected += chunk
        decoded = collected.decode('utf-8', errors='replace')
        if expected in decoded:
            return decoded
    raise AssertionError(f'did not receive {expected!r}; got {collected!r}')


class DeepSeekHarnessProviderTests(unittest.TestCase):
    def test_provider_detection_and_capabilities(self):
        self.assertEqual(get_provider_key('dsh'), 'deepseek-harness')
        self.assertEqual(get_provider_key('deepseek-harness'), 'deepseek-harness')
        self.assertEqual(get_provider_key('/opt/local/dsh-worker'), 'deepseek-harness')
        self.assertEqual(get_provider_key('/opt/skill/providers/dsh_repl.py'), 'deepseek-harness')
        self.assertEqual(get_provider_key('cursor-agent'), 'cursor')
        self.assertEqual(get_prompt_patterns('dsh'), ['dsh❯'])
        self.assertEqual(get_system_prompt_mode('dsh'), 'cli_append')
        self.assertEqual(get_system_prompt_flag('dsh'), '--system-prompt')
        self.assertEqual(get_agents_md_mode('dsh'), 'disabled')
        self.assertEqual(get_mcp_config_mode('dsh'), 'unsupported')
        self.assertEqual(get_session_restore_mode('dsh'), 'repl_state')
        self.assertTrue(resolve_launcher_command('dsh').endswith('dsh_repl.py'))
        self.assertTrue(resolve_launcher_command('/opt/dsh/bin/dsh').endswith('dsh_repl.py'))
        self.assertTrue(resolve_launcher_command('/opt/local/dsh-worker').endswith('dsh_repl.py'))
        self.assertTrue(uses_native_enter(resolve_launcher_command('dsh')))
        self.assertEqual(
            default_dsh_state_file(Path('/workspace/demo'), 'example-worker'),
            Path('/workspace/demo/.claude/state/agent-manager/dsh/example-worker.json'),
        )

    def test_generated_model_overlay_is_provider_neutral(self):
        overlay = dsh_repl.make_model_overlay('my-provider', 'my-model')
        self.assertIn('provider: "my-provider"', overlay)
        self.assertIn('model: "my-model"', overlay)
        self.assertNotIn('reasoning', overlay)
        with self.assertRaises(ValueError):
            dsh_repl.make_model_overlay('my-provider', '')

    def test_fake_dsh_captures_session_then_resumes_and_bootstraps_once(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            fake = root / 'fake-dsh.py'
            fake.write_text(FAKE_DSH, encoding='utf-8')
            fake.chmod(0o755)
            state = root / 'runtime' / 'agent.json'
            log = root / 'fake-log.jsonl'
            extra_patch = root / 'site-route.yml'
            extra_patch.write_text('[]\n', encoding='utf-8')
            env = {**os.environ, 'FAKE_DSH_LOG': str(log)}
            base = [
                sys.executable, str(PROVIDERS_DIR / 'dsh_repl.py'),
                '--profile', 'agent-manager-smoke',
                '--state-file', str(state),
                '--dsh-bin', str(fake),
                '--provider', 'my-provider',
                '--model', 'my-model',
                '--patch', str(extra_patch),
                '--permission-mode', 'danger-full-access',
                '--system-prompt', 'bootstrap rules',
            ]
            first = subprocess.run(base, input='first task\n', text=True, capture_output=True, env=env, check=True)
            self.assertIn('dsh❯', first.stdout)
            self.assertIn('DSH busy…', first.stdout)
            self.assertIn('fake reply', first.stdout)
            self.assertEqual(json.loads(state.read_text(encoding='utf-8'))['session_id'], 'fake-dsh-session')
            second = subprocess.run(base, input='second task\n', text=True, capture_output=True, env=env, check=True)
            self.assertIn('fake reply', second.stdout)

            calls = [json.loads(line) for line in log.read_text(encoding='utf-8').splitlines()]
            self.assertEqual(len(calls), 2)
            self.assertIn('--json', calls[0]['argv'])
            self.assertNotIn('--session-id', calls[0]['argv'])
            self.assertIn(str(extra_patch), calls[0]['argv'])
            self.assertEqual(calls[0]['permission_mode'], 'danger-full-access')
            self.assertIn('bootstrap rules', calls[0]['payload'])
            self.assertIn('first task', calls[0]['payload'])
            self.assertIn('--session-id', calls[1]['argv'])
            self.assertEqual(calls[1]['argv'][calls[1]['argv'].index('--session-id') + 1], 'fake-dsh-session')
            self.assertEqual(calls[1]['payload'], 'second task')
            overlay = state.with_suffix('.dsh-model-overlay.yml').read_text(encoding='utf-8')
            self.assertIn('provider: "my-provider"', overlay)
            self.assertIn('model: "my-model"', overlay)

    def test_bracketed_multiline_paste_waits_for_native_enter_before_fake_dsh(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            fake = root / 'fake-dsh.py'
            fake.write_text(FAKE_DSH, encoding='utf-8')
            fake.chmod(0o755)
            state = root / 'agent.json'
            log = root / 'fake-log.jsonl'
            master, slave = pty.openpty()
            env = {**os.environ, 'FAKE_DSH_LOG': str(log)}
            process = subprocess.Popen(
                [
                    sys.executable, str(PROVIDERS_DIR / 'dsh_repl.py'),
                    '--profile', 'agent-manager-smoke',
                    '--state-file', str(state),
                    '--dsh-bin', str(fake),
                ],
                stdin=slave,
                stdout=slave,
                stderr=slave,
                env=env,
                close_fds=True,
            )
            os.close(slave)
            try:
                _read_until(master, 'dsh❯')
                os.write(master, b'\x1b[200~first line\nsecond line\x1b[201~')
                time.sleep(0.15)
                self.assertFalse(log.exists(), 'bracketed paste must not submit by itself')
                os.write(master, b'\r')
                _read_until(master, 'fake reply')
                calls = [json.loads(line) for line in log.read_text(encoding='utf-8').splitlines()]
                self.assertEqual(calls[0]['payload'], 'first line\nsecond line')
            finally:
                process.terminate()
                process.wait(timeout=5)
                os.close(master)


if __name__ == '__main__':
    unittest.main()
