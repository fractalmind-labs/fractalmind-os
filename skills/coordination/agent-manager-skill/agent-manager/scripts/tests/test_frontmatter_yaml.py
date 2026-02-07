import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import agent_config  # noqa: E402
import frontmatter_yaml  # noqa: E402


class FrontmatterYamlTests(unittest.TestCase):
    def test_flow_sequence_bare_words(self):
        data = frontmatter_yaml.safe_load("allowed-tools: [Read, Write, Edit, Bash, Task]")
        self.assertEqual(data["allowed-tools"], ["Read", "Write", "Edit", "Bash", "Task"])

    def test_nested_tmux_layout_example(self):
        payload = """\
        tmux:
          layout:
            split: h
            panes:
              - {}
              - split: v
                panes:
                  - {}
                  - {}
          target_pane: "1.1"
        """
        data = frontmatter_yaml.safe_load(textwrap.dedent(payload).strip())

        self.assertEqual(data["tmux"]["layout"]["split"], "h")
        self.assertEqual(data["tmux"]["layout"]["panes"][0], {})
        self.assertEqual(data["tmux"]["layout"]["panes"][1]["split"], "v")
        self.assertEqual(data["tmux"]["target_pane"], "1.1")

    def test_parse_agent_file_does_not_require_pyyaml(self):
        content = (
            "---\n"
            "name: dev\n"
            "enabled: true\n"
            "launcher_args: [\"--model=gpt-5.2\", \"--flag\", \"value with space\"]\n"
            "---\n"
            "# DEV ROLE\n\n"
            "Hello\n"
        )

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "EMP_0001.md"
            path.write_text(content, encoding="utf-8")
            config = agent_config.parse_agent_file(path)

        self.assertEqual(config["name"], "dev")
        self.assertTrue(config["enabled"])
        self.assertEqual(
            config["launcher_args"],
            ["--model=gpt-5.2", "--flag", "value with space"],
        )
        self.assertEqual(config["file_id"], "EMP_0001")
        self.assertIn("DEV ROLE", config["role_definition"])

    def test_unterminated_quote_in_flow_sequence_errors(self):
        with self.assertRaises(frontmatter_yaml.YamlParseError):
            frontmatter_yaml.safe_load('x: ["unterminated]')


if __name__ == "__main__":
    unittest.main()
