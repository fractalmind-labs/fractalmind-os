from __future__ import annotations

import argparse
import io
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from commands.inbound import drain_main_inbound_once  # noqa: E402
from commands.lifecycle import (  # noqa: E402
    cmd_assign,
    cmd_send,
    should_preempt_main_delivery,
    uses_native_enter,
)
from services.inbound_queue import append_inbound_message_event  # noqa: E402
from services.inbound_queue import enqueue_inbound_message  # noqa: E402
from services.inbound_queue import mark_inbound_message_state  # noqa: E402
from services.inbound_queue import was_message_yielded  # noqa: E402


def _main_deps(
    *,
    temp_root: Path,
    launcher: str,
    interrupts: list,
    sends: list,
    runtime: str = 'busy',
    stdin: str = 'urgent owner message',
    interrupt_ok: bool = True,
):
    resolved = {
        'cursor': '/home/test/.cursor/bin/cursor-agent',
        'grok': '/home/test/.local/bin/grok',
        'droid': 'droid',
        'codex': 'codex',
    }.get(launcher, launcher)

    return SimpleNamespace(
        __file__='main.py',
        resolve_agent=lambda _agent: {'name': 'main', 'file_id': 'main', 'launcher': launcher},
        get_agent_id=lambda config: config.get('file_id', '').lower(),
        check_tmux=lambda: True,
        session_exists=lambda agent_id: agent_id == 'main',
        argparse=argparse,
        time=SimpleNamespace(sleep=lambda _s: None),
        resolve_launcher_command=lambda _launcher: resolved,
        _should_use_codex_file_pointer=lambda _msg: False,
        get_repo_root=lambda: temp_root,
        write_codex_message_file=lambda *_args, **_kwargs: Path('/tmp/assign.md'),
        interrupt_agent=lambda agent_id, launcher='': interrupts.append((agent_id, launcher)) or interrupt_ok,
        send_keys=lambda agent_id, message, **kwargs: sends.append((agent_id, message, kwargs)) or True,
        get_agent_runtime_state=lambda _agent_id, launcher='': {
            'state': runtime,
            'reason': f'{runtime}_pattern:Thinking…',
        },
        Path=Path,
        sys=SimpleNamespace(stdin=io.StringIO(stdin)),
        enqueue_inbound_message=enqueue_inbound_message,
        mark_inbound_message_state=mark_inbound_message_state,
        was_message_yielded=was_message_yielded,
        append_inbound_message_event=append_inbound_message_event,
    )


class ShouldPreemptMainDeliveryTests(unittest.TestCase):
    def test_matrix(self):
        heartbeat = '# FractalBot Heartbeat\n\nRead HEARTBEAT.md'
        owner = 'owner Slack inbound'
        self.assertTrue(should_preempt_main_delivery('main', '/home/test/.local/bin/grok', owner))
        self.assertTrue(should_preempt_main_delivery('main', 'grok', owner))
        self.assertTrue(should_preempt_main_delivery('main', '/home/test/.cursor/bin/cursor-agent', owner))
        self.assertFalse(should_preempt_main_delivery('main', '/home/test/.local/bin/grok', heartbeat))
        self.assertFalse(should_preempt_main_delivery('main', 'cursor-agent', heartbeat))
        self.assertFalse(should_preempt_main_delivery('main', 'codex', owner))
        self.assertFalse(should_preempt_main_delivery('emp-0002', 'grok', owner))
        self.assertFalse(should_preempt_main_delivery('EMP_0002', '/usr/bin/grok', owner))

    def test_uses_native_enter(self):
        self.assertTrue(uses_native_enter('/home/test/.local/bin/grok'))
        self.assertTrue(uses_native_enter('codex'))
        self.assertTrue(uses_native_enter('/home/test/.cursor/bin/cursor-agent'))
        self.assertTrue(uses_native_enter('cursor'))
        self.assertFalse(uses_native_enter('droid'))


class MainTuiPreemptLifecycleTests(unittest.TestCase):
    def test_assign_main_preempts_grok_and_send_nows_when_busy(self):
        interrupts = []
        sends = []
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-grok-preempt-'))
        deps = _main_deps(
            temp_root=temp_root,
            launcher='grok',
            interrupts=interrupts,
            sends=sends,
            runtime='busy',
        )

        with redirect_stdout(io.StringIO()):
            rc = cmd_assign(
                argparse.Namespace(agent='main', task_file=None),
                deps=deps,
                start_handler=lambda _args: 0,
            )

        self.assertEqual(rc, 0)
        self.assertEqual(interrupts, [('main', '/home/test/.local/bin/grok')])
        self.assertEqual(len(sends), 2)
        self.assertIn('# Task Assignment', sends[0][1])
        self.assertTrue(sends[0][2].get('enter_via_key'))
        self.assertEqual(sends[1][1], '')
        self.assertTrue(sends[1][2].get('enter_via_key'))
        self.assertTrue(sends[1][2].get('send_enter'))

    def test_assign_main_grok_idle_still_sends_native_follow_up_enter(self):
        interrupts = []
        sends = []
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-grok-idle-'))
        deps = _main_deps(
            temp_root=temp_root,
            launcher='grok',
            interrupts=interrupts,
            sends=sends,
            runtime='idle',
        )

        with redirect_stdout(io.StringIO()):
            rc = cmd_assign(
                argparse.Namespace(agent='main', task_file=None),
                deps=deps,
                start_handler=lambda _args: 0,
            )

        self.assertEqual(rc, 0)
        self.assertEqual(len(interrupts), 1)
        self.assertEqual(len(sends), 2)
        self.assertIn('# Task Assignment', sends[0][1])
        self.assertTrue(sends[0][2].get('enter_via_key'))
        self.assertEqual(sends[1][1], '')
        self.assertTrue(sends[1][2].get('enter_via_key'))

    def test_assign_main_does_not_preempt_grok_heartbeat(self):
        interrupts = []
        sends = []
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-grok-hb-'))
        heartbeat = '# FractalBot Heartbeat\n\nRead HEARTBEAT.md'
        deps = _main_deps(
            temp_root=temp_root,
            launcher='grok',
            interrupts=interrupts,
            sends=sends,
            runtime='busy',
            stdin=heartbeat,
        )

        with redirect_stdout(io.StringIO()):
            rc = cmd_assign(
                argparse.Namespace(agent='main', task_file=None),
                deps=deps,
                start_handler=lambda _args: 0,
            )

        self.assertEqual(rc, 0)
        self.assertEqual(interrupts, [])
        self.assertEqual(len(sends), 1)

    def test_assign_main_preempts_cursor_without_send_now(self):
        interrupts = []
        sends = []
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-cursor-preempt-'))
        deps = _main_deps(
            temp_root=temp_root,
            launcher='cursor',
            interrupts=interrupts,
            sends=sends,
            runtime='busy',
        )

        with redirect_stdout(io.StringIO()):
            rc = cmd_assign(
                argparse.Namespace(agent='main', task_file=None),
                deps=deps,
                start_handler=lambda _args: 0,
            )

        self.assertEqual(rc, 0)
        self.assertEqual(interrupts, [('main', '/home/test/.cursor/bin/cursor-agent')])
        self.assertEqual(len(sends), 1)
        self.assertIn('# Task Assignment', sends[0][1])
        self.assertTrue(sends[0][2].get('enter_via_key'))
        self.assertFalse(sends[0][2].get('escape_first'))

    def test_assign_employee_grok_does_not_preempt(self):
        interrupts = []
        sends = []
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-emp-grok-'))
        deps = _main_deps(
            temp_root=temp_root,
            launcher='grok',
            interrupts=interrupts,
            sends=sends,
            runtime='busy',
        )
        deps.resolve_agent = lambda _agent: {
            'name': 'dev',
            'file_id': 'EMP_0002',
            'launcher': 'grok',
        }
        deps.get_agent_id = lambda config: config.get('file_id', '').lower()
        deps.session_exists = lambda agent_id: True

        with redirect_stdout(io.StringIO()):
            rc = cmd_assign(
                argparse.Namespace(agent='EMP_0002', task_file=None),
                deps=deps,
                start_handler=lambda _args: 0,
            )

        self.assertEqual(rc, 0)
        self.assertEqual(interrupts, [])
        self.assertEqual(len(sends), 1)

    def test_send_main_preempts_grok_when_busy(self):
        interrupts = []
        sends = []
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-grok-send-'))
        deps = _main_deps(
            temp_root=temp_root,
            launcher='grok',
            interrupts=interrupts,
            sends=sends,
            runtime='busy',
        )

        with redirect_stdout(io.StringIO()):
            rc = cmd_send(
                argparse.Namespace(agent='main', message='owner follow-up', send_enter=True),
                deps=deps,
            )

        self.assertEqual(rc, 0)
        self.assertEqual(len(interrupts), 1)
        self.assertEqual(sends[0][1], 'owner follow-up')
        self.assertEqual(sends[1][1], '')

    def test_assign_main_fails_when_interrupt_fails(self):
        interrupts = []
        sends = []
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-grok-int-fail-'))
        deps = _main_deps(
            temp_root=temp_root,
            launcher='grok',
            interrupts=interrupts,
            sends=sends,
            interrupt_ok=False,
        )

        output = io.StringIO()
        with redirect_stdout(output):
            rc = cmd_assign(
                argparse.Namespace(agent='main', task_file=None),
                deps=deps,
                start_handler=lambda _args: 0,
            )

        self.assertEqual(rc, 1)
        self.assertEqual(sends, [])
        self.assertIn('Failed to interrupt', output.getvalue())


class MainTuiPreemptInboundTests(unittest.TestCase):
    def test_inbound_drain_preempts_grok_once_then_send_nows(self):
        interrupts = []
        sends = []
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-grok-drain-'))
        first = enqueue_inbound_message(
            temp_root,
            agent_id='main',
            source='send',
            message_kind='message',
            message='first owner inbound',
        )
        second = enqueue_inbound_message(
            temp_root,
            agent_id='main',
            source='send',
            message_kind='message',
            message='second owner inbound',
        )
        self.assertTrue(first)
        self.assertTrue(second)

        deps = _main_deps(
            temp_root=temp_root,
            launcher='grok',
            interrupts=interrupts,
            sends=sends,
            runtime='busy',
        )

        with redirect_stdout(io.StringIO()):
            summary = drain_main_inbound_once(deps=deps, agent_id='main', trigger='test')

        self.assertEqual(summary['rc'], 0)
        self.assertEqual(summary['drained'], 2)
        self.assertEqual(len(interrupts), 1)
        payloads = [item[1] for item in sends]
        self.assertIn('first owner inbound', payloads)
        self.assertIn('second owner inbound', payloads)
        self.assertGreaterEqual(payloads.count(''), 1)
