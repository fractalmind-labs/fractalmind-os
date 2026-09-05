from __future__ import annotations
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import tmux_helper  # noqa: E402


class SendKeysTests(unittest.TestCase):
    @patch('tmux_helper._agent_pane_target', return_value='%1')
    @patch('tmux_helper.session_exists', return_value=True)
    @patch('tmux_helper.time.sleep', return_value=None)
    @patch('tmux_helper.subprocess.run')
    def test_multiline_paste_preserves_native_submit_boundaries(
        self, mock_run, _mock_sleep, _mock_session_exists, _mock_target,
    ):
        message = '# Task Assignment\n\n中文入站消息\n' + 'context\n' * 32
        for native_enter in (True, False):
            for send_enter in (True, False):
                with self.subTest(native_enter=native_enter, send_enter=send_enter):
                    commands = []
                    captures = iter(['composer\n', 'submitted\n'])
                    payloads = []

                    def fake_run(arguments, *positional, **kwargs):
                        commands.append(arguments)
                        if arguments[:4] == ['tmux', 'load-buffer', '-b', 'agent-send']:
                            payloads.append(Path(arguments[-1]).read_text())
                        if arguments[:2] == ['tmux', 'capture-pane']:
                            return subprocess.CompletedProcess(arguments, 0, stdout=next(captures))
                        return subprocess.CompletedProcess(arguments, 0, stdout='')

                    mock_run.side_effect = fake_run
                    result = tmux_helper.send_keys(
                        'main', message, send_enter=send_enter, enter_via_key=native_enter,
                    )

                    self.assertTrue(result)
                    self.assertEqual(payloads, [message])
                    paste = next(
                        command for command in commands
                        if command[:5] == ['tmux', 'paste-buffer', '-d', '-b', 'agent-send']
                    )
                    self.assertEqual('-p' in paste, native_enter)
                    enter_keys = [
                        command for command in commands
                        if command[:2] == ['tmux', 'send-keys']
                        and command[-1] in ('C-m', 'Enter')
                    ]
                    self.assertEqual(len(enter_keys), int(native_enter and send_enter))
                    newline_pastes = [
                        command for command in commands
                        if command[:5] == ['tmux', 'paste-buffer', '-d', '-b', 'enter-key']
                    ]
                    self.assertEqual(len(newline_pastes), int(not native_enter and send_enter))
                    if enter_keys:
                        self.assertLess(commands.index(paste), commands.index(enter_keys[0]))

    @patch('tmux_helper._agent_pane_target', return_value='%1')
    @patch('tmux_helper.session_exists', return_value=True)
    @patch('tmux_helper.time.sleep', return_value=None)
    @patch('tmux_helper.subprocess.run')
    def test_enter_via_key_uses_native_enter_first(self, mock_run, _mock_sleep, _mock_session_exists, _mock_target):
        commands = []
        capture_index = {'count': 0}

        def fake_run(args, *pargs, **kwargs):
            commands.append(args)
            if args[:5] == ['tmux', 'capture-pane', '-p', '-t', '%1']:
                capture_index['count'] += 1
                stdout = 'before\n' if capture_index['count'] == 1 else 'after\n'
                return subprocess.CompletedProcess(args=args, returncode=0, stdout=stdout)
            return subprocess.CompletedProcess(args=args, returncode=0, stdout='')

        mock_run.side_effect = fake_run

        ok = tmux_helper.send_keys(
            'emp-0001',
            'hello from test',
            send_enter=True,
            enter_via_key=True,
        )

        self.assertTrue(ok)
        self.assertTrue(any(cmd[:4] == ['tmux', 'send-keys', '-t', '%1'] and cmd[-1] == 'C-m' for cmd in commands))
        self.assertFalse(any(cmd[:4] == ['tmux', 'load-buffer', '-b', 'enter-key'] for cmd in commands))

    @patch('tmux_helper._agent_pane_target', return_value='%1')
    @patch('tmux_helper.session_exists', return_value=True)
    @patch('tmux_helper.time.sleep', return_value=None)
    @patch('tmux_helper.subprocess.run')
    def test_enter_via_key_returns_false_without_pasting_newline(
        self,
        mock_run,
        _mock_sleep,
        _mock_session_exists,
        _mock_target,
    ):
        commands = []

        def fake_run(args, *pargs, **kwargs):
            commands.append(args)
            if args[:5] == ['tmux', 'capture-pane', '-p', '-t', '%1']:
                return subprocess.CompletedProcess(args=args, returncode=0, stdout='unchanged\n')
            return subprocess.CompletedProcess(args=args, returncode=0, stdout='')

        mock_run.side_effect = fake_run

        ok = tmux_helper.send_keys(
            'emp-0001',
            'hello from test',
            send_enter=True,
            enter_via_key=True,
        )

        self.assertFalse(ok)
        self.assertTrue(any(cmd[:4] == ['tmux', 'send-keys', '-t', '%1'] and cmd[-1] == 'C-m' for cmd in commands))
        native_enters = [
            command for command in commands
            if command[:4] == ['tmux', 'send-keys', '-t', '%1'] and command[-1] == 'C-m'
        ]
        self.assertEqual(len(native_enters), 2)
        self.assertFalse(any(cmd[:4] == ['tmux', 'load-buffer', '-b', 'enter-key'] for cmd in commands))
        self.assertFalse(any(cmd[:5] == ['tmux', 'paste-buffer', '-d', '-b', 'enter-key'] for cmd in commands))

    @patch('tmux_helper._agent_pane_target', return_value='%1')
    @patch('tmux_helper.session_exists', return_value=True)
    @patch('tmux_helper.time.sleep', return_value=None)
    @patch('tmux_helper.subprocess.run')
    def test_enter_via_key_retries_without_pasting_newline(
        self,
        mock_run,
        _mock_sleep,
        _mock_session_exists,
        _mock_target,
    ):
        commands = []
        capture_outputs = iter(['unchanged\n'] * 12 + ['changed\n'])

        def fake_run(args, *pargs, **kwargs):
            commands.append(args)
            if args[:5] == ['tmux', 'capture-pane', '-p', '-t', '%1']:
                return subprocess.CompletedProcess(args=args, returncode=0, stdout=next(capture_outputs))
            return subprocess.CompletedProcess(args=args, returncode=0, stdout='')

        mock_run.side_effect = fake_run

        ok = tmux_helper.send_keys(
            'emp-0001',
            'hello from test',
            send_enter=True,
            enter_via_key=True,
        )

        self.assertTrue(ok)
        native_enters = [
            command for command in commands
            if command[:4] == ['tmux', 'send-keys', '-t', '%1'] and command[-1] == 'C-m'
        ]
        self.assertEqual(len(native_enters), 2)
        self.assertFalse(any(cmd[:4] == ['tmux', 'load-buffer', '-b', 'enter-key'] for cmd in commands))
        self.assertFalse(any(cmd[:5] == ['tmux', 'paste-buffer', '-d', '-b', 'enter-key'] for cmd in commands))


if __name__ == '__main__':
    unittest.main()
