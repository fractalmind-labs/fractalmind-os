#!/usr/bin/env python3
"""Adapt FractalBot's `assign AGENT` interface to a pinned Codex native queue.

Python 3.9+, standard library only. Configure with FRACTALBOT_CODEX_QUEUE_CONFIG
or ~/.config/fractalbot/codex-queue.json. No extra Agent or App server is started.
"""

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid


class DeliveryError(Exception):
    """A sanitized configuration or native queue delivery error."""


def load_settings(path=None):
    path = Path(path or os.environ.get(
        "FRACTALBOT_CODEX_QUEUE_CONFIG",
        str(Path.home() / ".config/fractalbot/codex-queue.json"),
    ))
    try:
        settings = json.loads(path.read_text())
        settings["thread_id"] = str(uuid.UUID(settings["thread_id"]))
        settings["workspace"] = str(Path(settings["workspace"]).resolve(strict=True))
        if not Path(settings["workspace"]).is_dir():
            raise ValueError("workspace must be a directory")
        binary = Path(settings["codex_bin"]).expanduser().resolve(strict=True)
        if not binary.is_file() or not os.access(binary, os.X_OK):
            raise ValueError("Codex binary must be executable")
        settings["codex_bin"] = str(binary)
        agent = settings.get("agent", "main")
        if not isinstance(agent, str) or not agent.strip():
            raise ValueError("agent must be nonempty")
        settings["agent"] = agent
        jobs = settings.get("heartbeat_jobs", [])
        if not isinstance(jobs, list) or any(not isinstance(j, str) or not j for j in jobs):
            raise ValueError("heartbeat_jobs must be a list of job names")
        settings["heartbeat_jobs"] = jobs
        return settings
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as exc:
        raise DeliveryError("Invalid Codex queue configuration.") from exc


def queue_prompt(settings, prompt, agent):
    if agent != settings["agent"]:
        raise DeliveryError("Agent does not match the configured queue target.")
    if not isinstance(prompt, str) or not prompt.strip():
        raise DeliveryError("An inbound message is required.")
    try:
        result = subprocess.run(
            [settings["codex_bin"], "queue", "--thread", settings["thread_id"],
             "--message", prompt],
            cwd=settings["workspace"], capture_output=True, text=True,
            encoding="utf-8", errors="replace", timeout=30,
        )
    except subprocess.TimeoutExpired as exc:
        raise DeliveryError("Native queue timed out; acceptance is unknown.") from exc
    except OSError as exc:
        raise DeliveryError("Unable to execute the Codex native queue.") from exc
    # Do not expose CLI stderr: it may quote private inbound message content.
    if result.returncode:
        raise DeliveryError("Native queue rejected delivery.")
    expected = f" for thread {settings['thread_id']}."
    if not result.stdout.strip().startswith("Queued message ") or not result.stdout.strip().endswith(expected):
        raise DeliveryError("Native queue did not confirm the configured thread.")
    return "Message accepted by the configured Codex native queue."


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["assign"])
    parser.add_argument("agent")
    args = parser.parse_args()
    try:
        settings = load_settings()
        if Path.cwd().resolve() != Path(settings["workspace"]):
            raise DeliveryError("Working directory does not match the configured workspace.")
        print(queue_prompt(settings, sys.stdin.read(), args.agent))
        return 0
    except DeliveryError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
