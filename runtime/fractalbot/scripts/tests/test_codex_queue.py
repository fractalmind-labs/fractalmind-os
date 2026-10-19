"""Boundary and recovery tests; never contact a real Codex session or channel."""

from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone
import fcntl
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import codex_queue_route as route
import codex_queue_relay as relay


THREAD = "00000000-0000-4000-8000-000000000001"
SCRIPTS = Path(__file__).resolve().parents[1]


class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binary = self.root / "fake-codex"
        self.binary.write_text('''#!/usr/bin/env python3
import json,sys
from pathlib import Path
root = Path(__file__).parent
with (root / "calls.jsonl").open("a") as out:
    out.write(json.dumps(sys.argv[1:]) + "\\n")
if (root / "reject").exists():
    print("SECRET-PROMPT-IN-CLI-ERROR", file=sys.stderr)
    raise SystemExit(1)
thread = sys.argv[sys.argv.index("--thread") + 1]
if (root / "wrong-target").exists():
    thread = "00000000-0000-4000-8000-000000000002"
print("Queued message 00000000-0000-4000-8000-000000000003 for thread " + thread + ".")
''')
        self.binary.chmod(0o700)
        self.config = self.root / "queue.json"
        self.settings = {
            "thread_id": THREAD, "workspace": str(self.root),
            "codex_bin": str(self.binary), "agent": "main",
            "heartbeat_jobs": ["project-heartbeat"],
        }
        self.config.write_text(json.dumps(self.settings))

    def calls(self):
        p = self.root / "calls.jsonl"
        return [json.loads(line) for line in p.read_text().splitlines()] if p.exists() else []

    def envelope(self, **changes):
        now = datetime.now(timezone.utc)
        result = {
            "id": "example-envelope", "source": "heartbeat",
            "job_id": "project-heartbeat", "run_id": "run-one",
            "selected_agent": "main", "scheduled_at": now.isoformat(),
            "expires_at": (now + timedelta(minutes=10)).isoformat(),
            "text": "Inspect actionable work.",
        }
        result.update(changes)
        return result

    def put(self, envelope, name="heartbeat.json", folder="inbox"):
        p = self.root / "relay" / folder / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(envelope))
        return p

    def drain(self):
        with redirect_stdout(io.StringIO()):
            return relay.relay(self.root / "relay", self.settings)

    def test_route_preserves_context_newlines_and_shell_metacharacters(self):
        prompt = "# Task Assignment\nchannel: feishu\nreceiver_id: example-bot\nchat_id: example-chat\n\n$(touch SHOULD_NOT_EXIST) `echo hi`\n测试"
        env = dict(os.environ, FRACTALBOT_CODEX_QUEUE_CONFIG=str(self.config))
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "codex_queue_route.py"), "assign", "main"],
            input=prompt, text=True, capture_output=True, cwd=self.root, env=env,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls(), [["queue", "--thread", THREAD, "--message", prompt]])
        self.assertNotIn(prompt, result.stdout + result.stderr)
        self.assertFalse((self.root / "SHOULD_NOT_EXIST").exists())

    def test_mismatched_agent_and_empty_prompt_never_invoke_cli(self):
        for prompt, agent in [("hello", "other"), ("  ", "main")]:
            with self.subTest(agent=agent, prompt=prompt), self.assertRaises(route.DeliveryError):
                route.queue_prompt(self.settings, prompt, agent)
        self.assertEqual(self.calls(), [])

    def test_workspace_mismatch_rejects_before_cli(self):
        wrong = self.root / "other"
        wrong.mkdir()
        env = dict(os.environ, FRACTALBOT_CODEX_QUEUE_CONFIG=str(self.config))
        result = subprocess.run(
            [sys.executable, str(SCRIPTS / "codex_queue_route.py"), "assign", "main"],
            input="private input", text=True, capture_output=True, cwd=wrong, env=env,
        )
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.calls(), [])
        self.assertNotIn("private input", result.stderr)

    def test_wrong_target_confirmation_is_failure(self):
        (self.root / "wrong-target").touch()
        with self.assertRaises(route.DeliveryError):
            route.queue_prompt(self.settings, "hello", "main")

    def test_cli_failure_does_not_expose_private_stderr(self):
        (self.root / "reject").touch()
        with self.assertRaises(route.DeliveryError) as caught:
            route.queue_prompt(self.settings, "private input", "main")
        self.assertNotIn("SECRET", str(caught.exception))

    def test_timeout_has_no_success_acknowledgement(self):
        with patch.object(route.subprocess, "run", side_effect=subprocess.TimeoutExpired("codex", 30)):
            with self.assertRaisesRegex(route.DeliveryError, "acceptance is unknown"):
                route.queue_prompt(self.settings, "hello", "main")

    def test_invalid_binding_is_rejected_without_exposing_it(self):
        for value in [[], {"thread_id": "SECRET-invalid-thread"}, dict(self.settings, heartbeat_jobs="all")]:
            self.config.write_text(json.dumps(value))
            with self.subTest(value=value), self.assertRaises(route.DeliveryError) as caught:
                route.load_settings(self.config)
            self.assertNotIn("SECRET", str(caught.exception))

    def test_failed_heartbeat_survives_and_retries_then_stays_done(self):
        self.put(self.envelope())
        (self.root / "reject").touch()
        self.assertEqual(self.drain(), 1)
        state = self.root / "relay"
        self.assertEqual(len(list((state / "processing").glob("*.json"))), 1)
        self.assertEqual(list((state / "done").glob("*.json")), [])
        (self.root / "reject").unlink()
        self.assertEqual(self.drain(), 0)
        self.assertEqual(self.drain(), 0)
        self.assertEqual(len(self.calls()), 2)  # one rejection, one acceptance
        prompt = self.calls()[-1][-1]
        self.assertIn("- job_id: project-heartbeat\n- run_id: run-one", prompt)
        self.assertIn("not a chat message", prompt)
        self.assertEqual(len(list((state / "done").glob("*.json"))), 1)

    def test_expired_unknown_wrong_agent_and_malformed_are_not_queued(self):
        self.put(self.envelope(expires_at="2000-01-01T00:00:00Z"), "expired.json")
        self.put(self.envelope(job_id="other-job"), "unknown.json")
        self.put(self.envelope(selected_agent="other"), "agent.json")
        self.put(self.envelope(expires_at="2030-01-01T00:00:00"), "naive.json")
        self.put([], "array.json")
        self.put(self.envelope(), "bad.json").write_text("{invalid")
        self.assertEqual(self.drain(), 0)
        self.assertEqual(self.calls(), [])
        state = self.root / "relay"
        self.assertEqual(len(list((state / "expired").glob("*.json"))), 1)
        self.assertEqual(len(list((state / "rejected").glob("*.json"))), 5)

    def test_restart_recovers_processing_and_repeated_run_is_not_resent(self):
        self.put(self.envelope(), folder="processing")
        self.assertEqual(self.drain(), 0)
        self.put(self.envelope(id="redelivery"))
        self.assertEqual(self.drain(), 0)
        self.assertEqual(len(self.calls()), 1)

    def test_new_coalesced_file_survives_archiving_an_older_run(self):
        path = self.put(self.envelope())
        original = relay.queue_prompt

        def queue_and_replace(*args):
            self.put(self.envelope(run_id="run-two"))
            return original(*args)

        with patch.object(relay, "queue_prompt", side_effect=queue_and_replace):
            self.assertEqual(self.drain(), 0)
        self.assertTrue(path.exists())
        self.assertEqual(self.drain(), 0)
        self.assertEqual(len(self.calls()), 2)

    def test_second_worker_does_not_claim_messages_while_locked(self):
        path = self.put(self.envelope())
        with (self.root / "relay" / ".relay.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assertEqual(self.drain(), 0)
        self.assertTrue(path.exists())
        self.assertEqual(self.calls(), [])


if __name__ == "__main__":
    unittest.main()
