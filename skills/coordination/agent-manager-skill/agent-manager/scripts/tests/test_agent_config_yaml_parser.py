from __future__ import annotations
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import agent_config  # noqa: E402


class AgentConfigYamlParserTests(unittest.TestCase):
    def setUp(self):
        self.temp_root = Path(tempfile.mkdtemp(prefix="agent-manager-yaml-"))

    def tearDown(self):
        shutil.rmtree(self.temp_root, ignore_errors=True)

    def _write_agent_file(self, rel_path: str, frontmatter: str, body: str = "# role\n") -> Path:
        path = self.temp_root / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"---\n{frontmatter.strip()}\n---\n{body}", encoding="utf-8")
        return path

    def test_parse_block_list_for_launcher_args_and_skills(self):
        agent_file = self._write_agent_file(
            "agents/EMP_0001/AGENTS.md",
            """
name: dev
description: Dev Agent
working_directory: ${REPO_ROOT}
launcher: claude
launcher_args:
  - --dangerously-skip-permissions
  - --model
  - sonnet
skills:
  - agent-manager
  - team-manager
""",
        )

        config = agent_config.parse_agent_file(agent_file)
        self.assertEqual(
            config.get("launcher_args"),
            ["--dangerously-skip-permissions", "--model", "sonnet"],
        )
        self.assertEqual(config.get("skills"), ["agent-manager", "team-manager"])

    def test_parse_block_list_of_dicts_for_schedules(self):
        agent_file = self._write_agent_file(
            "agents/EMP_0002/AGENTS.md",
            """
name: qa
description: QA Agent
working_directory: ${REPO_ROOT}
launcher: codex
schedules:
  - name: daily-check
    cron: "0 9 * * *"
    enabled: true
    max_runtime: 30m
  - name: weekly-report
    cron: "0 18 * * 5"
    enabled: false
""",
        )

        config = agent_config.parse_agent_file(agent_file)
        schedules = config.get("schedules")

        self.assertIsInstance(schedules, list)
        self.assertEqual(len(schedules), 2)
        self.assertEqual(schedules[0]["name"], "daily-check")
        self.assertEqual(schedules[0]["cron"], "0 9 * * *")
        self.assertTrue(schedules[0]["enabled"])
        self.assertEqual(schedules[0]["max_runtime"], "30m")
        self.assertEqual(schedules[1]["name"], "weekly-report")
        self.assertFalse(schedules[1]["enabled"])

    @patch("agent_config.get_repo_root")
    def test_resolve_main_keeps_block_list_launcher_args(self, mock_get_repo_root):
        repo_root = self.temp_root
        mock_get_repo_root.return_value = repo_root

        (repo_root / "agents").mkdir(parents=True, exist_ok=True)
        (repo_root / "AGENTS.md").write_text(
            """---
name: main
description: Main
working_directory: ${REPO_ROOT}
launcher: claude
launcher_args:
  - --dangerously-skip-permissions
skills:
  - agent-manager
---
# Main Agent
""",
            encoding="utf-8",
        )

        cfg = agent_config.resolve_agent("main")
        self.assertEqual(cfg.get("launcher"), "claude")
        self.assertEqual(cfg.get("launcher_args"), ["--dangerously-skip-permissions"])
        self.assertEqual(cfg.get("skills"), ["agent-manager"])


if __name__ == "__main__":
    unittest.main()
