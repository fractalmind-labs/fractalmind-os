"""Verify skill lookup supports the skills CLI project layout."""

import importlib.util
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def load_repo_root_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class SkillPathTests(unittest.TestCase):
    def test_managers_find_skills_cli_project_install(self):
        modules = {
            "agent": load_repo_root_module(
                "agent_repo_root",
                ROOT / "coordination/agent-manager-skill/agent-manager/scripts/repo_root.py",
            ),
            "team": load_repo_root_module(
                "team_repo_root",
                ROOT / "coordination/team-manager-skill/team-manager/scripts/repo_root.py",
            ),
        }
        with tempfile.TemporaryDirectory() as directory:
            project = Path(directory)
            (project / "agents").mkdir()
            (project / "teams").mkdir()
            for module in modules.values():
                skill_dir = project / ".agents/skills/example"
                skill_dir.mkdir(parents=True, exist_ok=True)
                (skill_dir / "SKILL.md").write_text("---\nname: example\n---\n")
                self.assertEqual(
                    module.get_skill_search_dirs(project)[0], project / ".agents/skills"
                )
                self.assertIn(project / ".agent/skills", module.get_skill_search_dirs(project))
            self.assertEqual(modules["agent"].find_repo_root(project / "agents"), project)
            self.assertEqual(modules["team"].find_repo_root(project / "teams"), project)
            self.assertEqual(
                modules["team"].find_skill_dir("example", project),
                project / ".agents/skills/example",
            )


if __name__ == "__main__":
    unittest.main()
