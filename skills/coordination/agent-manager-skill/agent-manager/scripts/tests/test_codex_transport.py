from __future__ import annotations
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import main  # noqa: E402


class CodexTransportTests(unittest.TestCase):
    def test_should_use_file_pointer_for_large_multiline_message(self):
        msg = "\n".join([f"line-{i}" for i in range(50)])
        self.assertTrue(main._should_use_codex_file_pointer(msg))

    def test_should_not_use_file_pointer_for_moderate_multiline_message(self):
        # Routing envelopes and task assignments of this size deliver inline
        # via atomic tmux buffer paste.
        msg = "\n".join([f"line-{i}" for i in range(20)])
        self.assertFalse(main._should_use_codex_file_pointer(msg))

    def test_should_not_use_file_pointer_for_short_single_line_message(self):
        msg = "please run unit tests"
        self.assertFalse(main._should_use_codex_file_pointer(msg))

    def test_thresholds_are_env_overridable(self):
        msg = "\n".join([f"line-{i}" for i in range(20)])
        old_lines = os.environ.pop('AGENT_MANAGER_CODEX_FILE_POINTER_MAX_LINES', None)
        os.environ['AGENT_MANAGER_CODEX_FILE_POINTER_MAX_LINES'] = '10'
        try:
            self.assertTrue(main._should_use_codex_file_pointer(msg))
        finally:
            if old_lines is None:
                os.environ.pop('AGENT_MANAGER_CODEX_FILE_POINTER_MAX_LINES', None)
            else:
                os.environ['AGENT_MANAGER_CODEX_FILE_POINTER_MAX_LINES'] = old_lines

    def test_invalid_threshold_env_falls_back_to_default(self):
        os.environ['AGENT_MANAGER_CODEX_FILE_POINTER_MAX_CHARS'] = 'not-a-number'
        try:
            self.assertFalse(main._should_use_codex_file_pointer('x' * 5000))
            self.assertTrue(main._should_use_codex_file_pointer('x' * 6000))
        finally:
            os.environ.pop('AGENT_MANAGER_CODEX_FILE_POINTER_MAX_CHARS', None)

    def test_write_codex_message_file_persists_content(self):
        temp_root = Path(tempfile.mkdtemp(prefix='agent-manager-codex-transport-'))
        try:
            f = main.write_codex_message_file(temp_root, 'emp-0008', 'assign', 'hello\nworld')
            self.assertTrue(f.exists())
            self.assertIn('/codex-messages/emp-0008/', str(f).replace('\\', '/'))
            content = f.read_text(encoding='utf-8')
            self.assertEqual(content, 'hello\nworld\n')
        finally:
            shutil.rmtree(temp_root, ignore_errors=True)


if __name__ == '__main__':
    unittest.main()
