#!/usr/bin/env python3
"""Drain an allowlisted FractalBot heartbeat inbox into a pinned Codex queue.

One-shot POSIX transport worker, intended for launchd WatchPaths or an existing
supervisor. This does not schedule heartbeats; FractalBot owns that schedule.
"""

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
from pathlib import Path
import sys
import time

from codex_queue_route import DeliveryError, load_settings, queue_prompt


def heartbeat_prompt(envelope, settings):
    if (envelope.get("source") != "heartbeat"
            or envelope.get("job_id") not in settings["heartbeat_jobs"]
            or envelope.get("selected_agent") != settings["agent"]
            or not isinstance(envelope.get("run_id"), str)
            or not envelope["run_id"]
            or not isinstance(envelope.get("text"), str)
            or not envelope["text"].strip()):
        raise ValueError("unexpected heartbeat envelope")
    expires = envelope.get("expires_at")
    if not isinstance(expires, str) or not expires:
        raise ValueError("heartbeat expiry is required")
    expiry = datetime.fromisoformat(expires.replace("Z", "+00:00"))
    if expiry.tzinfo is None:
        raise ValueError("heartbeat expiry must include timezone")
    lines = ["# FractalBot Heartbeat", ""]
    for key in ("job_id", "run_id", "scheduled_at", "expires_at"):
        if envelope.get(key):
            lines.append(f"- {key}: {envelope[key]}")
    lines.extend([
        "- runtime: codexAppCDP (durable inbox to native Codex queue)",
        f"- agent: {settings['agent']}", "",
        "This is an autonomous wakeup, not a chat message. "
        "Do not reply to a messaging channel unless the task itself requires it.",
        "", "Instruction:", envelope["text"], "",
    ])
    return "\n".join(lines), expiry


def relay(root, settings):
    for name in ("inbox", "processing", "done", "expired", "rejected"):
        (root / name).mkdir(parents=True, exist_ok=True, mode=0o700)
    failed = False
    with (root / ".relay.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return 0
        # Claim before consuming so a newly coalesced heartbeat cannot be
        # removed when we archive an older envelope with the same inbox name.
        for path in sorted((root / "inbox").glob("*.json")):
            if path.is_symlink():
                path.rename(root / "rejected" / f"{time.time_ns()}-{path.name}")
            else:
                path.rename(root / "processing" / f"{time.time_ns()}-{path.name}")
        for path in sorted((root / "processing").glob("*.json")):
            try:
                envelope = json.loads(path.read_text())
                prompt, expiry = heartbeat_prompt(envelope, settings)
                key = hashlib.sha256(
                    f"{envelope['job_id']}\0{envelope['run_id']}".encode()
                ).hexdigest()
                receipt = root / "done" / f"{key}.json"
                if receipt.exists():
                    path.rename(root / "done" / f"duplicate-{path.name}")
                    continue
                if expiry <= datetime.now(timezone.utc):
                    path.rename(root / "expired" / path.name)
                    print("Archived expired heartbeat.", flush=True)
                    continue
            except (ValueError, KeyError, TypeError, AttributeError):
                path.rename(root / "rejected" / path.name)
                print("Rejected invalid or non-allowlisted heartbeat.", flush=True)
                continue
            try:
                queue_prompt(settings, prompt, settings["agent"])
            except DeliveryError:
                failed = True
                print("Native queue delivery unconfirmed; retained for retry.", flush=True)
                continue
            path.rename(receipt)
            print("Heartbeat accepted by the configured Codex native queue.", flush=True)
    return 1 if failed else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path.home() / ".fractalbot/codex-queue")
    args = parser.parse_args()
    try:
        return relay(args.root, load_settings())
    except (DeliveryError, OSError) as exc:
        # Filesystem errors can include sensitive paths; report the type only.
        print(f"Codex heartbeat relay failed ({type(exc).__name__}).", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
