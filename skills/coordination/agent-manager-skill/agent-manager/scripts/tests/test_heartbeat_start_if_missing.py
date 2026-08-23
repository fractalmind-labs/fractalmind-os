from __future__ import annotations

import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import main  # noqa: E402


class HeartbeatStartIfMissingTests(unittest.TestCase):
    def setUp(self):
        self.temp_root = Path(tempfile.mkdtemp(prefix='hb-start-if-missing-'))

    def tearDown(self):
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def test_flag_defaults_false(self):
        self.assertFalse(main._heartbeat_start_if_missing_enabled({}))
        self.assertFalse(main._heartbeat_start_if_missing_enabled({'start_if_missing': False}))
        self.assertFalse(main._heartbeat_start_if_missing_enabled({'start_if_missing': 'false'}))
        self.assertFalse(main._heartbeat_start_if_missing_enabled(None))

    def test_flag_true_values(self):
        self.assertTrue(main._heartbeat_start_if_missing_enabled({'start_if_missing': True}))
        self.assertTrue(main._heartbeat_start_if_missing_enabled({'start_if_missing': 'true'}))
        self.assertTrue(main._heartbeat_start_if_missing_enabled({'start_if_missing': 'yes'}))
        self.assertTrue(main._heartbeat_start_if_missing_enabled({'start_if_missing': 1}))

    def test_cooldown_only_for_failed_attempts(self):
        agent_id = 'emp-0001'
        now = 1_700_000_000.0
        main._mark_start_if_missing_attempt(self.temp_root, agent_id, status='started', now=now)
        self.assertFalse(
            main._start_if_missing_cooldown_active(self.temp_root, agent_id, now=now + 1)
        )
        main._mark_start_if_missing_attempt(self.temp_root, agent_id, status='failed', now=now)
        self.assertTrue(
            main._start_if_missing_cooldown_active(self.temp_root, agent_id, now=now + 10)
        )
        self.assertFalse(
            main._start_if_missing_cooldown_active(
                self.temp_root,
                agent_id,
                now=now + main._START_IF_MISSING_COOLDOWN_SECONDS + 1,
            )
        )
        payload = json.loads(
            main._start_if_missing_state_path(self.temp_root, agent_id).read_text(encoding='utf-8')
        )
        self.assertEqual(payload['status'], 'failed')

    def test_helper_skips_without_start_when_flag_off(self):
        starts = []
        with patch('main.session_exists', return_value=False), patch(
            'main.cmd_start', side_effect=lambda _args: starts.append('called') or 0
        ):
            ok = main._maybe_start_missing_heartbeat_session(
                agent_name='qa-agent',
                agent_id='emp-0001',
                agent_file_id='EMP_0001',
                heartbeat={'enabled': True},
                repo_root=self.temp_root,
            )
        self.assertFalse(ok)
        self.assertEqual(starts, [])

    def test_helper_starts_when_flag_on_and_session_appears(self):
        calls = {'exists': 0}

        def fake_exists(_agent_id):
            calls['exists'] += 1
            return calls['exists'] > 1

        with patch('main.session_exists', side_effect=fake_exists), patch(
            'main.cmd_start', return_value=0
        ) as mock_start:
            ok = main._maybe_start_missing_heartbeat_session(
                agent_name='qa-agent',
                agent_id='emp-0001',
                agent_file_id='EMP_0001',
                heartbeat={'start_if_missing': True},
                repo_root=self.temp_root,
            )
        self.assertTrue(ok)
        mock_start.assert_called_once()
        self.assertEqual(mock_start.call_args.args[0].agent, 'EMP_0001')
        payload = json.loads(
            main._start_if_missing_state_path(self.temp_root, 'emp-0001').read_text(encoding='utf-8')
        )
        self.assertEqual(payload['status'], 'started')

    def test_helper_cooldown_skips_second_failed_start(self):
        with patch('main.session_exists', return_value=False), patch(
            'main.cmd_start', return_value=1
        ) as mock_start:
            first = main._maybe_start_missing_heartbeat_session(
                agent_name='qa-agent',
                agent_id='emp-0001',
                agent_file_id='EMP_0001',
                heartbeat={'start_if_missing': True},
                repo_root=self.temp_root,
            )
            second = main._maybe_start_missing_heartbeat_session(
                agent_name='qa-agent',
                agent_id='emp-0001',
                agent_file_id='EMP_0001',
                heartbeat={'start_if_missing': True},
                repo_root=self.temp_root,
            )
        self.assertFalse(first)
        self.assertFalse(second)
        self.assertEqual(mock_start.call_count, 1)

    @patch('main._run_heartbeat_attempt')
    @patch('main._maybe_rollover_heartbeat_session', return_value=None)
    @patch('main._maybe_run_main_inbound_heartbeat_sweep', return_value=False)
    @patch('main.has_pending_inbound_messages', return_value=False)
    @patch('main._detect_agent_context_left_percent', return_value=80)
    @patch('main.resolve_launcher_command', return_value='codex')
    @patch('main.session_exists', return_value=False)
    @patch('main.cmd_start')
    @patch('main.resolve_agent')
    @patch('main.check_tmux', return_value=True)
    def test_cmd_heartbeat_run_default_skips_missing_session(
        self,
        _mock_tmux,
        mock_resolve_agent,
        mock_start,
        _mock_session,
        _mock_launcher,
        _mock_context,
        _mock_queue,
        _mock_sweep,
        _mock_rollover,
        mock_run_attempt,
    ):
        mock_resolve_agent.return_value = {
            'name': 'qa-agent',
            'file_id': 'EMP_0001',
            'enabled': True,
            'heartbeat': {'enabled': True, 'session_mode': 'restore'},
            'launcher': 'codex',
        }
        args = type('Args', (), {'agent': 'EMP_0001', 'timeout': None, 'retry': None})()
        out = io.StringIO()
        with patch('sys.stdout', out):
            result = main.cmd_heartbeat_run(args)
        self.assertEqual(result, 0)
        mock_start.assert_not_called()
        mock_run_attempt.assert_not_called()
        self.assertIn('skipping heartbeat', out.getvalue())

    @patch('main._append_heartbeat_audit_event')
    @patch('main.time.sleep', return_value=None)
    @patch(
        'main._run_heartbeat_attempt',
        return_value={
            'send_status': 'ok',
            'ack_status': 'ack',
            'failure_type': '',
            'duration_ms': 50,
        },
    )
    @patch('main._maybe_rollover_heartbeat_session', return_value=None)
    @patch('main._maybe_run_main_inbound_heartbeat_sweep', return_value=False)
    @patch('main.has_pending_inbound_messages', return_value=False)
    @patch('main._detect_agent_context_left_percent', return_value=80)
    @patch('main.resolve_launcher_command', return_value='codex')
    @patch('main.get_repo_root')
    @patch('main.session_exists')
    @patch('main.cmd_start', return_value=0)
    @patch('main.resolve_agent')
    @patch('main.check_tmux', return_value=True)
    def test_cmd_heartbeat_run_start_if_missing_continues_tick(
        self,
        _mock_tmux,
        mock_resolve_agent,
        mock_start,
        mock_session,
        mock_repo_root,
        _mock_launcher,
        _mock_context,
        _mock_queue,
        _mock_sweep,
        _mock_rollover,
        mock_run_attempt,
        _mock_sleep,
        _mock_audit,
    ):
        mock_repo_root.return_value = self.temp_root
        mock_session.side_effect = lambda _agent_id: mock_start.called
        mock_resolve_agent.return_value = {
            'name': 'qa-agent',
            'file_id': 'EMP_0001',
            'enabled': True,
            'heartbeat': {
                'enabled': True,
                'session_mode': 'restore',
                'start_if_missing': True,
                'recovery': {
                    'max_retries': 0,
                    'retry_backoff_seconds': 0,
                    'fallback_mode': 'none',
                },
            },
            'launcher': 'codex',
        }
        args = type(
            'Args',
            (),
            {
                'agent': 'EMP_0001',
                'timeout': None,
                'retry': 0,
                'backoff_seconds': 0,
                'fallback_mode': 'none',
                'notify_on_failure': False,
                'notifier_channel': None,
            },
        )()
        result = main.cmd_heartbeat_run(args)
        self.assertEqual(result, 0)
        mock_start.assert_called_once()
        mock_run_attempt.assert_called()


if __name__ == '__main__':
    unittest.main()
