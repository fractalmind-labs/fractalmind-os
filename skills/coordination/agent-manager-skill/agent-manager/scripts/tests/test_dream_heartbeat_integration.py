from __future__ import annotations

import argparse
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import main  # noqa: E402


class DreamHeartbeatIntegrationTests(unittest.TestCase):
    def test_heartbeat_schedules_dream_when_interval_exceeds_idle_after(self):
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-dream-heartbeat-'))
        work_dir = temp_root / 'workspace'
        work_dir.mkdir(parents=True, exist_ok=True)
        (work_dir / 'DREAM.md').write_text('follow dream\n', encoding='utf-8')
        agent_config = {
            'name': 'main',
            'file_id': 'main',
            'working_directory': str(work_dir),
            'launcher': 'codex',
            'heartbeat': {
                'enabled': True,
                'cron': '0 */4 * * *',
                'max_runtime': '8m',
                'session_mode': 'auto',
                'dream': {
                    'enabled': True,
                    'idle_after': '1h',
                    'max_runtime': '15m',
                },
            },
            'enabled': True,
        }

        out = io.StringIO()
        with redirect_stdout(out), \
                patch('main.check_tmux', return_value=True), \
                patch('main.resolve_agent', return_value=agent_config), \
                patch('main.get_agent_id', return_value='main'), \
                patch('main.session_exists', return_value=True), \
                patch('main.resolve_launcher_command', return_value='codex'), \
                patch('main.get_repo_root', return_value=temp_root), \
                patch('main._detect_agent_context_left_percent', return_value=None), \
                patch('main._maybe_rollover_heartbeat_session', return_value=None), \
                patch('main._maybe_run_main_inbound_heartbeat_sweep', return_value=False), \
                patch('main.has_pending_inbound_messages', return_value=False), \
                patch('main._heartbeat_preflight_runtime_state', return_value=('idle', 'ready')), \
                patch('main._run_heartbeat_attempt', return_value={
                    'send_status': 'ok',
                    'ack_status': 'ack',
                    'ack_evidence': 'direct_heartbeat_ok',
                    'failure_type': '',
                    'reason_code': 'HB_ACK_OK',
                    'duration_ms': 1000,
                }), \
                patch('main.cmd_timer', return_value=0) as mock_cmd_timer:
            rc = main.cmd_heartbeat_run(
                argparse.Namespace(
                    agent='main',
                    timeout=None,
                    retry=None,
                    backoff_seconds=None,
                    fallback_mode=None,
                    notify_on_failure=False,
                    notifier_channel=None,
                )
            )

        self.assertEqual(rc, 0)
        mock_cmd_timer.assert_called_once()
        timer_args = mock_cmd_timer.call_args.args[0]
        self.assertEqual(timer_args.timer_command, 'command')
        self.assertIn('dream', timer_args.command_args)
        state_file = temp_root / '.claude' / 'state' / 'agent-manager' / 'dream-state' / 'main.json'
        payload = json.loads(state_file.read_text(encoding='utf-8'))
        self.assertTrue(payload['triggered_for_window'])


if __name__ == '__main__':
    unittest.main()
