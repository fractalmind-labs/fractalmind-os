#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = REPO_ROOT / ".claude" / "state" / "supervisor_watchdog.json"

BASE_INTERVAL_SECONDS = 15 * 60
MAX_BACKOFF_SECONDS = 4 * 60 * 60
NUDGE_COOLDOWN_SECONDS = 2 * 60 * 60
REPEAT_SAME_WORK_COOLDOWN_SECONDS = 60 * 60


@dataclass
class WorkItem:
    repo_dir: str
    github_repo: str
    number: str
    url: str
    title: str


def _now_ts() -> int:
    return int(time.time())


def _run(
    args: list[str],
    *,
    cwd: Path | None = None,
    check: bool = True,
    timeout_s: int = 60,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=str(cwd) if cwd else None,
        check=check,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=timeout_s,
    )


def _load_state() -> dict:
    try:
        data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except FileNotFoundError:
        return {}
    except Exception:
        return {}
    return {}


def _save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _get_activity() -> dict[str, str]:
    proc = _run(
        [
            "python3",
            ".claude/skills/agent-manager/scripts/main.py",
            "activity",
            "developer",
            "qa",
        ],
        cwd=REPO_ROOT,
        check=False,
        timeout_s=30,
    )
    activity: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        if ":" not in line:
            continue
        name, status = line.split(":", 1)
        activity[name.strip()] = status.strip()
    return activity


def _start_agent(name: str) -> str:
    proc = _run(
        ["python3", ".claude/skills/agent-manager/scripts/main.py", "start", name],
        cwd=REPO_ROOT,
        check=False,
        timeout_s=90,
    )
    out = (proc.stdout + proc.stderr).strip()
    return out.splitlines()[-1] if out else f"started {name}"


def _send_agent(name: str, message: str) -> str:
    proc = _run(
        ["python3", ".claude/skills/agent-manager/scripts/main.py", "send", name, message],
        cwd=REPO_ROOT,
        check=False,
        timeout_s=30,
    )
    out = (proc.stdout + proc.stderr).strip()
    return out.splitlines()[-1] if out else f"sent to {name}"


def _find_work() -> WorkItem | None:
    proc = _run(
        ["bash", "scripts/workspace-next-issue.sh"],
        cwd=REPO_ROOT,
        check=False,
        timeout_s=60,
    )
    if proc.returncode != 0:
        return None
    line = proc.stdout.strip().splitlines()[0] if proc.stdout.strip() else ""
    parts = line.split("\t")
    if len(parts) < 5:
        return None
    repo_dir, github_repo, number, url, title = parts[:5]
    return WorkItem(repo_dir=repo_dir, github_repo=github_repo, number=number, url=url, title=title)


def main() -> int:
    now = _now_ts()
    state = _load_state()

    next_scan_ts = int(state.get("next_scan_ts") or 0)
    backoff_steps = int(state.get("backoff_steps") or 0)

    activity = _get_activity()
    dev_status = activity.get("developer", "unknown")
    qa_status = activity.get("qa", "unknown")

    actions: list[str] = []

    # Keep agents alive if they stopped.
    for agent, status in (("developer", dev_status), ("qa", qa_status)):
        if status == "stopped":
            actions.append(_start_agent(agent))

    # Rate-limit nudges for blocked/error to avoid repeated token burn.
    for agent, status in (("developer", dev_status), ("qa", qa_status)):
        if status not in ("blocked", "error"):
            continue
        last_nudge_ts = int(state.get(f"last_nudge_{agent}_ts") or 0)
        if now - last_nudge_ts < NUDGE_COOLDOWN_SECONDS:
            continue
        actions.append(_send_agent(agent, "continue follow workflows/github_issues.md"))
        state[f"last_nudge_{agent}_ts"] = now

    # Backoff-controlled work scan: only when developer is idle.
    work: WorkItem | None = None
    if dev_status == "idle":
        if now >= next_scan_ts:
            work = _find_work()

            if work is None:
                backoff_steps = min(backoff_steps + 1, 16)
                delay = min(MAX_BACKOFF_SECONDS, BASE_INTERVAL_SECONDS * (2**backoff_steps))
                state["backoff_steps"] = backoff_steps
                state["next_scan_ts"] = now + delay
            else:
                last_work_url = str(state.get("last_work_url") or "")
                last_work_nudge_ts = int(state.get("last_work_nudge_ts") or 0)
                state["backoff_steps"] = 0
                state["next_scan_ts"] = now + BASE_INTERVAL_SECONDS
                state["last_work_url"] = work.url

                if work.url != last_work_url or now - last_work_nudge_ts >= REPEAT_SAME_WORK_COOLDOWN_SECONDS:
                    msg = (
                        f"work found: {work.url} (repo {work.github_repo}, dir {work.repo_dir}). "
                        "continue follow workflows/github_issues.md"
                    )
                    actions.append(_send_agent("developer", msg))
                    state["last_work_nudge_ts"] = now

    _save_state(state)

    # 1–3 line report for the supervisor schedule.
    status_line = f"status developer={dev_status} qa={qa_status}"
    if work:
        status_line += f" next={work.url}"

    if actions:
        action_line = "action " + "; ".join(actions)
    else:
        action_line = "action none"

    if dev_status == "idle":
        next_scan_ts = int(state.get("next_scan_ts") or 0)
        seconds = max(0, next_scan_ts - now)
        backoff_line = f"backoff next_scan_in={seconds}s steps={int(state.get('backoff_steps') or 0)}"
        print(status_line)
        print(action_line)
        print(backoff_line)
    else:
        print(status_line)
        print(action_line)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

