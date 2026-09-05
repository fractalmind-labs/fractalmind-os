from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import main


class DeliveryEntrypointTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='agent-manager-entrypoint-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.active_script = self.root / '.agent/skills/agent-manager/scripts/main.py'
        self.active_script.parent.mkdir(parents=True)
        self.active_script.write_text('')
        self.old_script = self.root / 'projects/old-checkout/agent-manager/scripts/main.py'

    def delegate(self, arguments, script=None):
        with patch.object(main, 'get_repo_root', return_value=self.root), \
                patch.object(main, '__file__', str(script or self.old_script)), \
                patch.object(sys, 'argv', [str(script or self.old_script), *arguments]), \
                patch.object(main.os, 'execv') as execute:
            main._delegate_workspace_delivery()
        return execute

    def test_protocol_reply_delegates_with_exact_arguments(self):
        arguments = [
            'message', 'reply', '--from', 'EMP_0025', '--to', 'main',
            '--reply-to', 'msg_original', '--body', '中文回复\nsecond line',
        ]
        execute = self.delegate(arguments)
        execute.assert_called_once_with(
            sys.executable, [sys.executable, str(self.active_script.resolve()), *arguments],
        )

    def test_all_delivery_commands_use_active_install(self):
        for command in ('send', 'assign', 'message', 'inbound'):
            with self.subTest(command=command):
                self.delegate([command, '--help']).assert_called_once()

    def test_lifecycle_and_other_commands_are_not_redirected(self):
        for command in ('start', 'stop', 'status', 'heartbeat', 'doctor', '--help'):
            with self.subTest(command=command):
                self.delegate([command]).assert_not_called()

    def test_no_command_is_not_redirected(self):
        self.delegate([]).assert_not_called()

    def test_active_install_does_not_redirect_to_itself(self):
        self.delegate(['message', 'send', 'main'], script=self.active_script).assert_not_called()

    def test_symlink_to_current_script_does_not_loop(self):
        source = self.root / 'active.py'
        source.write_text('')
        self.active_script.unlink()
        self.active_script.symlink_to(source)
        self.delegate(['assign', 'main'], script=source).assert_not_called()

    def test_standalone_checkout_without_active_install_keeps_local_behavior(self):
        self.active_script.unlink()
        self.delegate(['message', 'send', 'main']).assert_not_called()

    def test_exec_failure_does_not_fall_back_to_old_transport(self):
        with patch.object(main, 'get_repo_root', return_value=self.root), \
                patch.object(main, '__file__', str(self.old_script)), \
                patch.object(sys, 'argv', [str(self.old_script), 'assign', 'main']), \
                patch.object(main.os, 'execv', side_effect=OSError('cannot execute')):
            with self.assertRaises(OSError):
                main._delegate_workspace_delivery()

    def test_cli_delegation_preserves_stdin_arguments_and_exit_status(self):
        self.active_script.write_text(
            'import json, sys\n'
            'print(json.dumps({"argv": sys.argv[1:], "stdin": sys.stdin.read()}))\n'
            'sys.exit(7)\n'
        )
        arguments = [
            'message', 'reply', '--from', 'qa', '--to', 'main',
            '--reply-to', 'msg_original', '--body', "中文回复\nquoted ' body",
        ]
        stdin = 'piped 中文\nsecond line\n'
        result = subprocess.run(
            [sys.executable, str(SCRIPTS_DIR / 'main.py'), *arguments],
            input=stdin,
            text=True,
            capture_output=True,
            cwd=self.root,
            env={**os.environ, 'REPO_ROOT': str(self.root)},
            timeout=30,
        )
        self.assertEqual(result.returncode, 7)
        self.assertEqual(json.loads(result.stdout), {'argv': arguments, 'stdin': stdin})
        self.assertIn('Using workspace agent-manager:', result.stderr)


if __name__ == '__main__':
    unittest.main()
