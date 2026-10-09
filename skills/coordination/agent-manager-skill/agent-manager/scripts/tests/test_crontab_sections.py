from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import schedule_helper  # noqa: E402

START = schedule_helper.CRONTAB_START_MARKER
END = schedule_helper.CRONTAB_END_MARKER


class CrontabSectionTests(unittest.TestCase):
    """Several workspaces share one user crontab; a sync touches only its own block."""

    def test_removes_only_this_workspace_section(self):
        crontab = "\n".join([
            "0 1 * * * backup.sh",
            f"{START} for /home/u/a",
            "*/5 * * * * cd /home/u/a && run-a",
            END,
            f"{START} for /home/u/b",
            "0 * * * * cd /home/u/b && run-b",
            END,
            f"{START}",
            "0 2 * * * legacy-unscoped",
            END,
        ])
        cleaned = schedule_helper.remove_agent_manager_section(crontab, "/home/u/a")
        self.assertNotIn("run-a", cleaned)
        self.assertIn("run-b", cleaned)
        self.assertIn("legacy-unscoped", cleaned, "another project's legacy block is preserved")
        self.assertIn("backup.sh", cleaned)
        self.assertEqual(cleaned.count(END), 2)

    def test_without_workspace_removes_every_section(self):
        crontab = "\n".join(["x", f"{START} for /a", "a", END, f"{START} for /b", "b", END])
        self.assertEqual(schedule_helper.remove_agent_manager_section(crontab).strip(), "x")


if __name__ == "__main__":
    unittest.main()
