#!/usr/bin/env python3
"""Audit GitHub OKR issue bodies for basic hierarchy and alignment hygiene."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import dataclass
from typing import Any


def run_json(args: list[str]) -> Any:
    proc = subprocess.run(args, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return json.loads(proc.stdout or "[]")


def has_label(issue: dict[str, Any], name: str) -> bool:
    return any(label.get("name") == name for label in issue.get("labels", []))


def field_value(body: str, name: str) -> str:
    match = re.search(rf"(?im)^\s*{re.escape(name)}\s*:\s*(.+?)\s*$", body)
    if not match:
        return ""
    value = match.group(1).strip()
    return "" if value.lower() in {"", "none", "n/a", "na", "tbd", "<url or none>", "<parent kr issue url>"} else value


def has_section(body: str, section: str) -> bool:
    return bool(re.search(rf"(?im)^##\s+{re.escape(section)}\s*$", body))


def contains_weekly_update(text: str) -> bool:
    return bool(re.search(r"(?im)^##\s+Weekly OKR update\s+-\s+\d{4}-\d{2}-\d{2}", text))


def has_weekly_update(repo: str, issue_number: int, body: str, skip_comments: bool) -> bool:
    if contains_weekly_update(body):
        return True
    if skip_comments:
        return False
    issue = run_json(["gh", "issue", "view", str(issue_number), "--repo", repo, "--comments", "--json", "comments"])
    return any(contains_weekly_update(comment.get("body") or "") for comment in issue.get("comments", []))


@dataclass
class Finding:
    number: int
    title: str
    url: str
    severity: str
    code: str
    message: str


def audit_issue(issue: dict[str, Any], repo: str, skip_comments: bool) -> list[Finding]:
    body = issue.get("body") or ""
    number = issue["number"]
    title = issue["title"]
    url = issue["url"]
    findings: list[Finding] = []

    def add(severity: str, code: str, message: str) -> None:
        findings.append(Finding(number, title, url, severity, code, message))

    is_objective = has_label(issue, "okr:objective")
    is_kr = has_label(issue, "okr:key-result")

    if not is_objective and not is_kr:
        if not field_value(body, "Parent KR"):
            add("error", "orphan-initiative", "Initiative or task has no Parent KR.")
        return findings

    if is_objective:
        if not has_section(body, "Objective"):
            add("error", "missing-objective-section", "Objective issue is missing an Objective section.")
        if "Team" in body and not field_value(body, "Parent KR"):
            add("warning", "team-objective-without-parent", "Team Objective appears to have no Parent KR.")

    if is_kr:
        for required in ("Baseline", "Target", "Current", "Confidence", "Health"):
            if not field_value(body, required):
                add("error", f"missing-{required.lower()}", f"KR is missing metric field: {required}.")
        if not field_value(body, "Owner"):
            add("warning", "missing-owner", "KR has no Owner.")
        if not has_section(body, "Measurement"):
            add("warning", "missing-measurement", "KR has no Measurement section.")
        contribution = field_value(body, "Contribution type")
        parent_kr = field_value(body, "Parent KR")
        rationale = field_value(body, "Alignment rationale")
        if parent_kr and not contribution:
            add("error", "missing-contribution-type", "Child KR has Parent KR but no Contribution type.")
        if parent_kr and not rationale:
            add("warning", "missing-alignment-rationale", "Child KR has Parent KR but no Alignment rationale.")
        if contribution == "Direct" and not parent_kr:
            add("warning", "direct-without-parent", "Direct contribution is set but Parent KR is missing.")
        if not has_weekly_update(repo, number, body, skip_comments):
            add("warning", "missing-weekly-update", "No weekly OKR update comment or body section was detected.")

    return findings


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit OKR issue alignment hygiene.")
    parser.add_argument("--repo", default="", help="OWNER/REPO. Defaults to gh repo view.")
    parser.add_argument("--milestone", default="", help="Filter by milestone title.")
    parser.add_argument("--label", default="okr", help="Issue label to query.")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument("--skip-comments", action="store_true", help="Do not inspect issue comments for weekly update comments.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of Markdown.")
    args = parser.parse_args()

    repo = args.repo
    if not repo:
        repo_info = run_json(["gh", "repo", "view", "--json", "nameWithOwner"])
        repo = repo_info["nameWithOwner"]

    cmd = [
        "gh",
        "issue",
        "list",
        "--repo",
        repo,
        "--state",
        "all",
        "--label",
        args.label,
        "--limit",
        str(args.limit),
        "--json",
        "number,title,url,body,labels,state",
    ]
    if args.milestone:
        cmd.extend(["--milestone", args.milestone])

    issues = run_json(cmd)
    findings = [finding for issue in issues for finding in audit_issue(issue, repo, args.skip_comments)]

    if args.json:
        print(json.dumps([finding.__dict__ for finding in findings], ensure_ascii=False, indent=2))
        return 1 if any(f.severity == "error" for f in findings) else 0

    print(f"# OKR Alignment Audit\n\nRepo: `{repo}`")
    if args.milestone:
        print(f"Milestone: `{args.milestone}`")
    print(f"Issues audited: {len(issues)}")
    print(f"Findings: {len(findings)}\n")
    if not findings:
        print("No alignment hygiene findings.")
        return 0
    for finding in findings:
        print(f"- **{finding.severity.upper()}** `{finding.code}` [#{finding.number}]({finding.url}) {finding.title}: {finding.message}")
    return 1 if any(f.severity == "error" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
