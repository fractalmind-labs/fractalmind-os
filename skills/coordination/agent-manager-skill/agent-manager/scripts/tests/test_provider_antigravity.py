from __future__ import annotations

import argparse
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
if str(SCRIPTS_DIR.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR.parent))

import main  # noqa: E402
import tmux_helper  # noqa: E402
from commands.lifecycle import uses_native_enter  # noqa: E402
from providers import (  # noqa: E402
    get_agents_md_mode,
    get_mcp_config_mode,
    get_prompt_patterns,
    get_provider_key,
    get_runtime_config,
    get_session_restore_flag,
    get_session_restore_mode,
    get_system_prompt_flag,
    get_system_prompt_mode,
    missing_launcher_help,
    resolve_launcher_command,
)
from runtime_state import detect_first_pattern, evaluate_runtime_state  # noqa: E402


SECRET = 'agy-test-secret-should-never-leak'
CONVERSATION_ID = '4a7905f2-bc89-4ea2-98d0-1c6812e14108'

# Live Antigravity CLI 1.5.18 pane excerpts from an isolated tmux capture.
LIVE_IDLE_PANE = """\
      ▄▀▀▄        Antigravity CLI 1.5.18
     ▀▀▀▀▀▀       someone@example.com (Google AI Pro)
    ▀▀▀▀▀▀▀▀      Gemini 4 Neon (Low)
   ▄▀▀    ▀▀▄     /tmp/agytest
  ▄▀▀      ▀▀▄
────────────────────────────────────────────────────────────
> List the files here using a shell command, then reply DONE
● Ran (ls -la) (ctrl+o to expand)
  DONE
────────────────────────────────────────────────────────────
>
────────────────────────────────────────────────────────────
? for shortcuts                                         auto · Gemini 4 Neon · low
"""

LIVE_BUSY_PANE = """\
────────────────────────────────────────────────────────────
> List the files here using a shell command, then reply DONE
⣻  Generating...
────────────────────────────────────────────────────────────
>
────────────────────────────────────────────────────────────
esc to cancel                                           auto · Gemini 4 Neon · low
"""

LIVE_TRUST_PANE = """\
Accessing workspace:
/tmp/agytest
Do you trust the contents of this project?
Antigravity CLI requires permission to read, edit, and execute files here.
> Yes, I trust this folder
  No, exit
  ↑/↓ Navigate · enter Confirm
"""


def _agy_agent_config(working_dir: str) -> dict:
    return {
        'name': 'neon-dev',
        'file_id': 'EMP_AGY',
        'launcher': 'agy',
        'launcher_args': ['--model', 'gemini-4-neon-high', '--dangerously-skip-permissions'],
        'enabled': True,
        'working_directory': working_dir,
        'role_definition': 'You are a test worker. Print NEON-DEV DONE when finished.',
    }


def _write_summary_index(root: Path, rows: list[tuple[str, list[str], str, int]]) -> None:
    """Create a minimal agy conversation_summaries.db plus conversation files."""
    root.mkdir(parents=True, exist_ok=True)
    (root / 'conversations').mkdir(exist_ok=True)
    conn = sqlite3.connect(root / 'conversation_summaries.db')
    try:
        conn.execute(
            'CREATE TABLE conversation_summaries ('
            'conversation_id text PRIMARY KEY, workspace_uris text NOT NULL, '
            'last_modified_time datetime NOT NULL, nesting_depth integer NOT NULL DEFAULT 0)'
        )
        for conversation_id, uris, modified, depth in rows:
            conn.execute(
                'INSERT INTO conversation_summaries VALUES (?, ?, ?, ?)',
                (conversation_id, json.dumps(uris) if uris else '', modified, depth),
            )
            (root / 'conversations' / f'{conversation_id}.db').touch()
        conn.commit()
    finally:
        conn.close()


def _write_conversation_executor(root: Path, conversation_id: str, workspace_uri: str) -> None:
    """Store a workspace URI the way agy's executor_metadata blob does."""
    data = workspace_uri.encode('utf-8')
    blob = b'(\xe8\x070\xd0\x0fJ\x02\x08\x01Z\x02\x08\x00b' + main._protobuf_string(workspace_uri) + b'j\x02\x08\x00'
    assert data in blob
    path = root / 'conversations' / f'{conversation_id}.db'
    path.unlink(missing_ok=True)
    conn = sqlite3.connect(path)
    try:
        conn.execute('CREATE TABLE executor_metadata (idx integer PRIMARY KEY, data blob)')
        conn.execute('INSERT INTO executor_metadata VALUES (0, ?)', (blob,))
        conn.commit()
    finally:
        conn.close()


class AntigravityProviderTests(unittest.TestCase):
    def test_launcher_names_map_to_antigravity(self):
        self.assertEqual(get_provider_key('agy'), 'antigravity')
        self.assertEqual(get_provider_key('antigravity'), 'antigravity')
        self.assertEqual(get_provider_key('antigravity-cli'), 'antigravity')
        self.assertEqual(get_provider_key('/Users/test/.local/bin/agy'), 'antigravity')

    def test_gemini_cli_is_not_antigravity(self):
        self.assertEqual(get_provider_key('gemini'), 'gemini')
        self.assertEqual(get_provider_key('/usr/local/bin/gemini'), 'gemini')

    def test_provider_capabilities(self):
        self.assertEqual(get_system_prompt_mode('agy'), 'cli_append')
        self.assertEqual(get_system_prompt_flag('agy'), '--prompt-interactive')
        self.assertEqual(get_agents_md_mode('agy'), 'cwd')
        self.assertEqual(get_mcp_config_mode('agy'), 'unsupported')
        self.assertEqual(get_session_restore_mode('agy'), 'cli_optional_arg')
        self.assertEqual(get_session_restore_flag('agy'), '--conversation')
        self.assertEqual(get_prompt_patterns('agy'), [])

    def test_agy_uses_native_enter(self):
        self.assertTrue(uses_native_enter('agy'))
        self.assertTrue(uses_native_enter('/Users/test/.local/bin/agy'))
        self.assertFalse(uses_native_enter('gemini'))

    def test_runtime_state_from_live_panes(self):
        cfg = get_runtime_config('agy')
        busy = evaluate_runtime_state(
            output=LIVE_BUSY_PANE, runtime_config=cfg, session_running=True, output_readable=True,
        )
        idle = evaluate_runtime_state(
            output=LIVE_IDLE_PANE, runtime_config=cfg, session_running=True, output_readable=True,
        )
        trust = evaluate_runtime_state(
            output=LIVE_TRUST_PANE, runtime_config=cfg, session_running=True, output_readable=True,
        )
        self.assertEqual(busy.get('state'), 'busy')
        self.assertEqual(idle.get('state'), 'idle')
        self.assertEqual(trust.get('state'), 'blocked')
        self.assertIsNotNone(detect_first_pattern(LIVE_TRUST_PANE, cfg.get('blocked_patterns', [])))

    def test_resolves_local_bin_and_falls_back_to_name(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home = Path(tmpdir)
            agy_bin = home / '.local' / 'bin' / 'agy'
            agy_bin.parent.mkdir(parents=True)
            agy_bin.touch()
            with patch.dict(os.environ, {'HOME': str(home)}):
                self.assertEqual(resolve_launcher_command('agy'), str(agy_bin))
                self.assertEqual(resolve_launcher_command('antigravity'), str(agy_bin))

        with tempfile.TemporaryDirectory() as tmpdir:
            home = Path(tmpdir)
            original_exists = Path.exists

            def exists_under_fake_home(self):
                try:
                    return original_exists(self) and str(self).startswith(str(home))
                except Exception:
                    return False

            with patch.dict(os.environ, {'HOME': str(home)}), \
                 patch.object(Path, 'exists', exists_under_fake_home):
                self.assertEqual(resolve_launcher_command('agy'), 'agy')

    def test_missing_help_is_specific_and_secret_free(self):
        with patch.dict(os.environ, {'GEMINI_API_KEY': SECRET}):
            text = missing_launcher_help('antigravity')
        self.assertIn('Antigravity CLI (agy) not found', text)
        self.assertNotIn(SECRET, text)

    def test_wait_for_prompt_treats_empty_patterns_as_ready(self):
        with patch.object(tmux_helper, '_agent_pane_target', return_value='agent-emp-agy:0.0'), \
             patch.object(tmux_helper.time, 'sleep'):
            self.assertTrue(tmux_helper.wait_for_prompt('emp-agy', 'agy', timeout=30))

    def test_restore_args_use_conversation_flag(self):
        args = main._apply_session_restore_args(
            provider_key='antigravity',
            launcher='agy',
            launcher_args=['--model', 'gemini-4-neon-high'],
            restore_flag='--conversation',
            session_id=CONVERSATION_ID,
        )
        self.assertEqual(args, ['--conversation', CONVERSATION_ID, '--model', 'gemini-4-neon-high'])

    def test_conversation_index_snapshot_find_and_exists(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cwd = Path(tmpdir) / 'work'
            cwd.mkdir()
            uri = cwd.resolve().as_uri()
            old_id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
            subagent_id = 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee'
            other_id = 'cccccccc-bbbb-4ccc-8ddd-eeeeeeeeeeee'
            root = Path(tmpdir) / 'agy'
            _write_summary_index(root, [
                (old_id, [uri], '2026-11-26 07:00:00', 0),
                (CONVERSATION_ID, [uri + '/'], '2026-11-26 08:00:00', 0),
                (subagent_id, [uri], '2026-11-26 09:00:00', 1),
                (other_id, ['file:///tmp/other-work'], '2026-11-26 10:00:00', 0),
            ])
            with patch('main._antigravity_root', return_value=root):
                self.assertEqual(main._snapshot_antigravity_sessions(str(cwd)), {old_id, CONVERSATION_ID})
                self.assertTrue(main._antigravity_session_exists(str(cwd), old_id))
                self.assertFalse(main._antigravity_session_exists(str(cwd), other_id))
                self.assertFalse(main._antigravity_session_exists(str(cwd), 'not-a-uuid'))
                self.assertEqual(
                    main._find_new_antigravity_session_id(str(cwd), before_session_ids={old_id}),
                    CONVERSATION_ID,
                )
                self.assertEqual(
                    main._find_new_provider_session_id_with_retry(
                        'antigravity', str(cwd), before_paths={old_id, CONVERSATION_ID}, timeout_s=0,
                    ),
                    '',
                )
                (root / 'conversations' / f'{old_id}.db').unlink()
                self.assertFalse(main._provider_session_exists('antigravity', str(cwd), old_id))

    def test_empty_index_workspace_falls_back_to_conversation_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cwd = Path(tmpdir) / 'work-1'
            sibling = Path(tmpdir) / 'work-10'
            cwd.mkdir()
            sibling.mkdir()
            sibling_id = 'dddddddd-bbbb-4ccc-8ddd-eeeeeeeeeeee'
            bare_id = 'eeeeeeee-bbbb-4ccc-8ddd-eeeeeeeeeeee'
            root = Path(tmpdir) / 'agy'
            _write_summary_index(root, [
                (CONVERSATION_ID, [], '2026-11-26 08:00:00', 0),
                (sibling_id, [], '2026-11-26 09:00:00', 0),
                (bare_id, [], '2026-11-26 10:00:00', 0),
            ])
            _write_conversation_executor(root, CONVERSATION_ID, cwd.resolve().as_uri())
            _write_conversation_executor(root, sibling_id, sibling.resolve().as_uri())
            with patch('main._antigravity_root', return_value=root):
                self.assertEqual(main._snapshot_antigravity_sessions(str(cwd)), {CONVERSATION_ID})
                self.assertEqual(main._snapshot_antigravity_sessions(str(sibling)), {sibling_id})
                self.assertEqual(
                    main._find_new_antigravity_session_id(str(cwd), before_session_ids=set()),
                    CONVERSATION_ID,
                )

    def test_index_read_falls_back_when_read_only_open_fails(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            cwd = Path(tmpdir) / 'work'
            cwd.mkdir()
            root = Path(tmpdir) / 'agy'
            _write_summary_index(root, [(CONVERSATION_ID, [cwd.resolve().as_uri()], '2026-11-26 08:00:00', 0)])
            real_connect = sqlite3.connect

            def connect(target, *args, **kwargs):
                if kwargs.get('uri'):
                    raise sqlite3.OperationalError('unable to open database file')
                return real_connect(target, *args, **kwargs)

            with patch('main._antigravity_root', return_value=root), patch('sqlite3.connect', side_effect=connect):
                self.assertTrue(main._antigravity_session_exists(str(cwd), CONVERSATION_ID))
            index = root / 'conversation_summaries.db'
            conn = main._open_antigravity_db(index)
            try:
                with self.assertRaises(sqlite3.OperationalError):
                    conn.execute('DELETE FROM conversation_summaries')
            finally:
                conn.close()

    def test_missing_index_is_empty(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('main._antigravity_root', return_value=Path(tmpdir) / 'none'):
                self.assertEqual(main._snapshot_antigravity_sessions(tmpdir), set())
                self.assertFalse(main._antigravity_session_exists(tmpdir, CONVERSATION_ID))

    def _run_start(self, tmpdir: str, *, stored_id: str = '', indexed_id: str = '', binary_exists: bool = True):
        args = argparse.Namespace(agent='EMP_AGY', working_dir=None, restore=True, tmux_layout='sessions')
        work = Path(tmpdir) / 'work'
        work.mkdir(exist_ok=True)
        agent_config = _agy_agent_config(str(work))
        root = Path(tmpdir) / 'agy'
        if stored_id or indexed_id:
            _write_summary_index(root, [(stored_id or indexed_id, [work.resolve().as_uri()], '2026-11-26 08:00:00', 0)])
        calls = {'n': 0}
        started: list[str] = []

        def session_exists(_agent_id):
            calls['n'] += 1
            return calls['n'] > 1

        def start_session(agent_id, command, layout='sessions'):
            started.append(command)
            return True

        with patch.dict(os.environ, {'GEMINI_API_KEY': SECRET}), \
             patch('main.check_tmux', return_value=True), \
             patch('main.resolve_agent', return_value=agent_config), \
             patch('main.get_agent_id', return_value='emp-agy'), \
             patch('main.session_exists', side_effect=session_exists), \
             patch('main.get_repo_root', return_value=Path(tmpdir)), \
             patch('main.resolve_launcher_command', return_value='agy'), \
             patch('main.launcher_binary_exists', return_value=binary_exists), \
             patch('main.start_session', side_effect=start_session), \
             patch('main.get_session_info', return_value={'session': 'agent-emp-agy', 'mode': 'sessions'}), \
             patch('main.wait_for_prompt', return_value=True), \
             patch('main.wait_for_agent_ready', return_value=True), \
             patch('main.inject_system_prompt') as inject, \
             patch('main._antigravity_root', return_value=root), \
             patch('main._load_provider_session_id', return_value=stored_id), \
             patch('main._save_provider_session_id') as save:
            self.last_save = save
            output = io.StringIO()
            with redirect_stdout(output):
                rc = main.cmd_start(args)
        return rc, output.getvalue(), started, inject

    def test_start_passes_system_prompt_as_first_interactive_turn(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rc, text, started, inject = self._run_start(tmpdir)
        self.assertEqual(rc, 0, text)
        self.assertEqual(len(started), 1)
        self.assertIn('--prompt-interactive', started[0])
        self.assertIn('system-prompts/emp-agy.txt', started[0])
        self.assertIn('gemini-4-neon-high', started[0])
        self.assertNotIn('--conversation', started[0])
        self.assertNotIn(SECRET, started[0])
        inject.assert_not_called()

    def test_stored_conversation_is_resumed_without_reprompt(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rc, text, started, inject = self._run_start(tmpdir, stored_id=CONVERSATION_ID)
        self.assertEqual(rc, 0, text)
        self.assertIn('--conversation', started[0])
        self.assertIn(CONVERSATION_ID, started[0])
        self.assertNotIn('--prompt-interactive', started[0])
        inject.assert_not_called()

    def test_rediscovered_conversation_is_resumed_and_saved(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rc, text, started, inject = self._run_start(tmpdir, indexed_id=CONVERSATION_ID)
        self.assertEqual(rc, 0, text)
        self.assertIn('--conversation', started[0])
        self.assertIn(CONVERSATION_ID, started[0])
        inject.assert_not_called()
        self.last_save.assert_called_once()
        self.assertEqual(self.last_save.call_args.kwargs['session_id'], CONVERSATION_ID)

    def test_start_fails_clearly_when_agy_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rc, text, started, _ = self._run_start(tmpdir, binary_exists=False)
        self.assertEqual(rc, 1)
        self.assertEqual(started, [])
        self.assertIn('Antigravity CLI (agy) not found', text)
        self.assertNotIn(SECRET, text)


if __name__ == '__main__':
    unittest.main()
