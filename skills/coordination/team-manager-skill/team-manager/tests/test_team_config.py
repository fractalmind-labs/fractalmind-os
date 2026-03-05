import os
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"


class TeamConfigTests(unittest.TestCase):
    def setUp(self):
        self._old_env = dict(os.environ)

    def tearDown(self):
        os.environ.clear()
        os.environ.update(self._old_env)

    def test_list_and_resolve_team(self):
        import sys

        sys.path.insert(0, str(SCRIPTS_DIR))
        from team_config import list_all_teams, resolve_team, validate_team_config

        with tempfile.TemporaryDirectory(prefix="team-manager-skill-") as tmp_dir:
            teams_dir = Path(tmp_dir) / "teams"
            teams_dir.mkdir(parents=True, exist_ok=True)

            os.environ["TEAMS_DIR"] = str(teams_dir)

            (teams_dir / "backend.md").write_text(
                textwrap.dedent(
                    """\
                    ---
                    name: backend
                    description: Backend team
                    lead_agent: EMP_0001
                    members:
                      - employee_id: EMP_0001
                        role: lead
                      - employee_id: EMP_0002
                        role: dev
                    ---

                    # Backend Team

                    ```mermaid
                    graph TD
                      A --> B
                    ```
                    """
                ),
                encoding="utf-8",
            )

            teams = list_all_teams()
            self.assertIn("backend", teams)

            team = resolve_team("backend")
            self.assertIsNotNone(team)
            self.assertEqual(team.get("name"), "backend")

            errors = validate_team_config(team)
            self.assertEqual(errors, [])


if __name__ == "__main__":
    unittest.main()
