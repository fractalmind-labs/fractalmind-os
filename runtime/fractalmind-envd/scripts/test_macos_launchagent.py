import importlib.util
import plistlib
import subprocess
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("macos_launchagent.py")
SPEC = importlib.util.spec_from_file_location("macos_launchagent", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class LaunchAgentTest(unittest.TestCase):
    def test_absolute_path_does_not_resolve_symlinks(self):
        self.assertEqual(
            MODULE.absolute_path("/usr/local/bin/envd"),
            Path("/usr/local/bin/envd"),
        )

    def test_build_plist_is_restartable_aqua_agent(self):
        payload = MODULE.build_plist(
            label="ai.fractalmind.envd",
            binary=Path("/usr/local/bin/envd"),
            config=Path("/Users/test/.config/envd/sentinel.yaml"),
            log_dir=Path("/Users/test/Library/Logs/envd"),
            home=Path("/Users/test"),
        )
        self.assertTrue(payload["RunAtLoad"])
        self.assertTrue(payload["KeepAlive"])
        self.assertEqual(payload["LimitLoadToSessionType"], "Aqua")
        self.assertEqual(
            payload["ProgramArguments"],
            ["/usr/local/bin/envd", "-config", "/Users/test/.config/envd/sentinel.yaml"],
        )
        self.assertIn("/opt/homebrew/bin", payload["EnvironmentVariables"]["PATH"])

    def test_render_outputs_valid_plist(self):
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "render",
                "--binary",
                "/usr/local/bin/envd",
                "--config",
                "/Users/test/.config/envd/sentinel.yaml",
                "--log-dir",
                "/Users/test/Library/Logs/envd",
                "--home",
                "/Users/test",
            ],
            check=True,
            stdout=subprocess.PIPE,
        )
        payload = plistlib.loads(result.stdout)
        self.assertEqual(payload["Label"], "ai.fractalmind.envd")


if __name__ == "__main__":
    unittest.main()
