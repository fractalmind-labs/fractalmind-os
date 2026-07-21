#!/usr/bin/env python3
"""Generate or validate the skills catalog inventory from git metadata."""

from __future__ import annotations

import argparse
import configparser
import difflib
import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = ROOT / "inventory" / "skills.json"


def run_git(*args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def canonical_repository(url: str) -> tuple[str, str]:
    normalized = url.strip()
    if normalized.startswith("git@github.com:"):
        slug = normalized.removeprefix("git@github.com:")
    elif normalized.startswith("https://github.com/"):
        slug = normalized.removeprefix("https://github.com/")
    else:
        raise ValueError(f"unsupported submodule URL: {url}")

    slug = slug.removesuffix(".git").strip("/")
    parts = slug.split("/")
    if len(parts) != 2 or not all(parts):
        raise ValueError(f"invalid GitHub repository slug: {slug}")
    return f"https://github.com/{slug}", parts[0]


def gitlink_commit(path: str) -> str:
    line = run_git("ls-tree", "HEAD", "--", path)
    if not line:
        raise ValueError(f"missing gitlink for {path}")
    mode, object_type, commit, tree_path = line.split(None, 3)
    if mode != "160000" or object_type != "commit" or tree_path != path:
        raise ValueError(f"{path} is not a git submodule gitlink: {line}")
    return commit


def expected_inventory() -> dict[str, object]:
    config = configparser.ConfigParser()
    config.read(ROOT / ".gitmodules")

    entries: list[dict[str, object]] = []
    seen_paths: set[str] = set()
    for section in config.sections():
        path = config.get(section, "path").strip()
        url = config.get(section, "url").strip()
        if path in seen_paths:
            raise ValueError(f"duplicate submodule path: {path}")
        seen_paths.add(path)

        parts = Path(path).parts
        if len(parts) != 2:
            raise ValueError(f"skill path must be category/name: {path}")
        category, name = parts
        if not (ROOT / category / "DESCRIPTION.md").is_file():
            raise ValueError(f"missing category description for {path}")

        repository, owner = canonical_repository(url)
        commit = gitlink_commit(path)
        entries.append(
            {
                "name": name,
                "category": category,
                "catalog_path": path,
                "owner": owner,
                "canonical_repository": repository,
                "source_policy": "canonical_source",
                "status": "active",
                "distribution_targets": [
                    {
                        "type": "git_submodule",
                        "repository": "https://github.com/fractalmind-ai/skills",
                        "path": path,
                        "commit": commit,
                    }
                ],
            }
        )

    entries.sort(key=lambda entry: str(entry["catalog_path"]))
    return {
        "schema_version": 1,
        "catalog_repository": "https://github.com/fractalmind-ai/skills",
        "generated_from": [".gitmodules", "HEAD gitlinks"],
        "skills": entries,
    }


def render(inventory: dict[str, object]) -> str:
    return json.dumps(inventory, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--write",
        action="store_true",
        help="rewrite inventory/skills.json from .gitmodules and HEAD gitlinks",
    )
    args = parser.parse_args()

    try:
        inventory = expected_inventory()
        expected = render(inventory)
    except (configparser.Error, OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"inventory generation failed: {error}", file=sys.stderr)
        return 1

    if args.write:
        INVENTORY_PATH.parent.mkdir(parents=True, exist_ok=True)
        INVENTORY_PATH.write_text(expected, encoding="utf-8")
        print(f"wrote {INVENTORY_PATH.relative_to(ROOT)}")
        return 0

    if not INVENTORY_PATH.is_file():
        print(f"missing {INVENTORY_PATH.relative_to(ROOT)}; run with --write", file=sys.stderr)
        return 1

    actual = INVENTORY_PATH.read_text(encoding="utf-8")
    if actual != expected:
        print("skill inventory is stale; run scripts/validate_inventory.py --write", file=sys.stderr)
        print(
            "".join(
                difflib.unified_diff(
                    actual.splitlines(keepends=True),
                    expected.splitlines(keepends=True),
                    fromfile="inventory/skills.json",
                    tofile="expected",
                )
            ),
            file=sys.stderr,
        )
        return 1

    print(f"skill inventory valid: {len(inventory['skills'])} entries")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
