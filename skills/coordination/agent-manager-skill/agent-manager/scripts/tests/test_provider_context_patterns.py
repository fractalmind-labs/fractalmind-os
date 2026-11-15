from __future__ import annotations
import sys
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))
if str(SCRIPTS_DIR.parent) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR.parent))

from providers import get_context_left_patterns, get_prompt_patterns, get_runtime_config  # noqa: E402


class ProviderContextPatternsTests(unittest.TestCase):
    def test_codex_has_context_left_pattern(self):
        patterns = get_context_left_patterns('codex')
        self.assertTrue(any('context left' in p.lower() for p in patterns))

    def test_claude_code_has_provider_specific_patterns(self):
        patterns = get_context_left_patterns('ccc')
        self.assertGreaterEqual(len(patterns), 2)

    def test_claude_code_prompt_patterns_include_arrow_variants(self):
        prompts = get_prompt_patterns('ccc')
        self.assertIn('❯', prompts)
        self.assertIn('›', prompts)

    def test_claude_code_runtime_patterns_include_current_activity_verbs(self):
        busy_patterns = get_runtime_config('ccc').get('busy_patterns', [])
        self.assertIn('Churning…', busy_patterns)
        self.assertIn('Mulling…', busy_patterns)
        self.assertIn('Perambulating…', busy_patterns)

    def test_generic_claude_runtime_patterns_include_current_activity_verbs(self):
        busy_patterns = get_runtime_config('claude').get('busy_patterns', [])
        self.assertIn('Churning…', busy_patterns)
        self.assertIn('Mulling…', busy_patterns)
        self.assertIn('Perambulating…', busy_patterns)

    def test_unknown_launcher_falls_back_to_generic_patterns(self):
        patterns = get_context_left_patterns('unknown-provider-launcher')
        self.assertTrue(any('context left' in p.lower() for p in patterns))


if __name__ == '__main__':
    unittest.main()
