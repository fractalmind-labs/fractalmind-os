import argparse
import io
import sys
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from commands.schedule_run import cmd_schedule_run  # noqa: E402


class ScheduleRunCommandTests(unittest.TestCase):
    def _run(self, deps, args=None):
        args = args or argparse.Namespace(agent='dev', job='daily', timeout=None)
        out = io.StringIO()
        with redirect_stdout(out):
            code = cmd_schedule_run(args, deps=deps, start_handler=lambda _args: 0)
        return code, out.getvalue()

    def test_schedule_run_fails_when_tmux_missing(self):
        deps = SimpleNamespace(check_tmux=lambda: False)
        code, text = self._run(deps)

        self.assertEqual(code, 1)
        self.assertIn('tmux is not installed', text)

    def test_schedule_run_fails_when_schedule_missing(self):
        deps = SimpleNamespace(
            check_tmux=lambda: True,
            get_agent_schedule=lambda _agent, _job: None,
        )
        code, text = self._run(deps)

        self.assertEqual(code, 1)
        self.assertIn("Schedule 'daily' not found", text)

    def test_schedule_run_skips_disabled_agent(self):
        deps = SimpleNamespace(
            check_tmux=lambda: True,
            get_agent_schedule=lambda _agent, _job: {
                '_agent_config': {
                    'name': 'dev',
                    'enabled': False,
                    'file_id': 'EMP_0001',
                    '_file_path': 'agents/EMP_0001.md',
                },
                'enabled': True,
            },
            get_agent_id=lambda _cfg: 'emp-0001',
        )
        code, text = self._run(deps)

        self.assertEqual(code, 0)
        self.assertIn("Agent 'dev' is disabled", text)
        self.assertIn('agents/EMP_0001.md', text)

    def test_schedule_run_skips_disabled_schedule(self):
        deps = SimpleNamespace(
            check_tmux=lambda: True,
            get_agent_schedule=lambda _agent, _job: {
                '_agent_config': {
                    'name': 'dev',
                    'enabled': True,
                    'file_id': 'EMP_0001',
                },
                'enabled': False,
            },
            get_agent_id=lambda _cfg: 'emp-0001',
        )
        code, text = self._run(deps)

        self.assertEqual(code, 0)
        self.assertIn("Schedule 'daily' is disabled", text)


if __name__ == '__main__':
    unittest.main()
