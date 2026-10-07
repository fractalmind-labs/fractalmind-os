from __future__ import annotations

import os
import shutil
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
import sys

if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import agent_config  # noqa: E402
import tmux_helper  # noqa: E402


class TmuxNamespaceTests(unittest.TestCase):
    def test_namespace_is_normalized_for_tmux_names(self):
        with patch.dict(os.environ, {tmux_helper.NAMESPACE_ENV_VAR: '  Family home/深圳  '}, clear=True):
            self.assertEqual(tmux_helper.get_namespace(), 'Family-home')
            self.assertEqual(tmux_helper.session_name_for_agent('main'), 'Family-home--main')
            self.assertEqual(tmux_helper.session_name_for_agent('emp-0001'), 'Family-home--agent-emp-0001')
            self.assertEqual(tmux_helper.get_group_session_name(), 'Family-home--agent-manager')

    def test_unset_namespace_preserves_legacy_names(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(tmux_helper.session_name_for_agent('main'), 'main')
            self.assertEqual(tmux_helper.session_name_for_agent('emp-0001'), 'agent-emp-0001')
            self.assertEqual(tmux_helper.get_group_session_name(), 'agent-manager')

    def test_list_sessions_only_returns_agents_in_active_namespace(self):
        calls = []

        def fake_run(command, **kwargs):
            calls.append(command)
            if command[:2] == ['tmux', 'ls']:
                return SimpleNamespace(
                    returncode=0,
                    stdout=(
                        'team--main: 1 windows\n'
                        'team--agent-emp-0001: 1 windows\n'
                        'other--agent-emp-0002: 1 windows\n'
                        'agent-emp-0003: 1 windows\n'
                    ),
                )
            return SimpleNamespace(returncode=0, stdout='team--agent-emp-0004\n')

        with patch.dict(os.environ, {tmux_helper.NAMESPACE_ENV_VAR: 'team'}, clear=True), \
                patch.object(tmux_helper.subprocess, 'run', side_effect=fake_run):
            self.assertEqual(tmux_helper.list_sessions(), ['emp-0001', 'emp-0004', 'main'])

        self.assertEqual(calls[1][:4], ['tmux', 'list-windows', '-t', 'team--agent-manager'])


class ConfiguredNamespaceTests(unittest.TestCase):
    def setUp(self):
        self.temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-namespace-'))

    def tearDown(self):
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def test_root_agents_namespace_is_used(self):
        (self.temp_root / 'AGENTS.md').write_text(
            '---\nnamespace: workspace-a\n---\n# Main\n', encoding='utf-8'
        )
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(agent_config.get_configured_namespace(self.temp_root), 'workspace-a')

    def test_environment_namespace_overrides_config(self):
        (self.temp_root / 'AGENTS.md').write_text(
            '---\nnamespace: workspace-a\n---\n# Main\n', encoding='utf-8'
        )
        with patch.dict(os.environ, {agent_config.AGENT_MANAGER_NAMESPACE_ENV: 'workspace-b'}, clear=True):
            self.assertEqual(agent_config.get_configured_namespace(self.temp_root), 'workspace-b')

    def test_nested_tmux_namespace_is_supported(self):
        (self.temp_root / 'AGENTS.md').write_text(
            '---\ntmux:\n  namespace: nested\n---\n# Main\n', encoding='utf-8'
        )
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(agent_config.get_configured_namespace(self.temp_root), 'nested')


if __name__ == '__main__':
    unittest.main()
