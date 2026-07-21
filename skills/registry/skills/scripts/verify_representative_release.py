#!/usr/bin/env python3
"""Verify one catalog release from canonical pin through install readback."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "releases" / "use-fractalbot" / "v0.1.0.json"
INVENTORY_PATH = ROOT / "inventory" / "skills.json"
SEMVER_PATTERN = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$"
)


def run(command: list[str], *, cwd: Path) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        detail = result.stderr.strip() or result.stdout.strip() or "no command output"
        raise ValueError(f"{' '.join(command)} failed in {cwd}: {detail}")
    return result.stdout.strip()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inventory_entry(name: str) -> dict[str, object]:
    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    matches = [entry for entry in inventory["skills"] if entry["name"] == name]
    require(len(matches) == 1, f"inventory must contain exactly one {name} entry")
    return matches[0]


def is_semver(value: object) -> bool:
    if not isinstance(value, str):
        return False
    match = SEMVER_PATTERN.fullmatch(value)
    if match is None:
        return False
    prerelease = match.group(4)
    if prerelease is None:
        return True
    return all(
        not (identifier.isdigit() and len(identifier) > 1 and identifier.startswith("0"))
        for identifier in prerelease.split(".")
    )


def validate_manifest_metadata(manifest: dict[str, object], manifest_path: Path) -> None:
    require(manifest.get("schema_version") == 1, "unsupported manifest schema_version")

    name = manifest.get("name")
    version = manifest.get("version")
    released_at = manifest.get("released_at")
    require(isinstance(name, str) and bool(name), "manifest name must be non-empty")
    require(
        is_semver(version),
        "manifest version must be semantic versioning",
    )
    require(isinstance(released_at, str), "released_at must be an ISO 8601 timestamp")
    try:
        timestamp = dt.datetime.fromisoformat(released_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("released_at must be an ISO 8601 timestamp") from error
    require(timestamp.utcoffset() is not None, "released_at must include a timezone")

    expected_suffix = Path("releases") / name / f"v{version}.json"
    if manifest_path.is_relative_to(ROOT):
        require(
            manifest_path.relative_to(ROOT) == expected_suffix,
            f"manifest path must be {expected_suffix}",
        )


def verify_manifest_immutable(manifest_path: Path, git_ref: str | None) -> None:
    if git_ref is None:
        return
    require(manifest_path.is_relative_to(ROOT), "immutable manifest must be inside catalog")
    relative_path = manifest_path.relative_to(ROOT).as_posix()
    run(["git", "rev-parse", "--verify", f"{git_ref}^{{commit}}"], cwd=ROOT)
    existing = run(["git", "ls-tree", git_ref, "--", relative_path], cwd=ROOT)
    if not existing:
        return
    released_content = run(["git", "show", f"{git_ref}:{relative_path}"], cwd=ROOT)
    require(
        manifest_path.read_text(encoding="utf-8") == released_content + "\n",
        f"released manifest is immutable and differs from {git_ref}",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", nargs="?", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--immutable-against",
        metavar="GIT_REF",
        help="reject changes to a manifest that already exists at GIT_REF",
    )
    args = parser.parse_args()

    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    validate_manifest_metadata(manifest, manifest_path)
    verify_manifest_immutable(manifest_path, args.immutable_against)
    name = manifest["name"]
    source_metadata = manifest["source"]
    install_metadata = manifest["install"]
    catalog_path = manifest["catalog_path"]
    source_path = ROOT / catalog_path

    entry = inventory_entry(name)
    require(entry["catalog_path"] == catalog_path, "catalog path mismatch")
    require(
        entry["canonical_repository"] == source_metadata["repository"],
        "canonical repository mismatch",
    )
    targets = entry["distribution_targets"]
    require(len(targets) == 1, "representative release requires one distribution target")
    require(targets[0]["path"] == catalog_path, "distribution path mismatch")
    require(targets[0]["commit"] == source_metadata["commit"], "inventory pin mismatch")
    require(source_path.is_dir(), f"submodule is not initialized: {catalog_path}")

    source_commit = run(["git", "rev-parse", "HEAD"], cwd=source_path)
    source_tree = run(["git", "rev-parse", "HEAD^{tree}"], cwd=source_path)
    require(source_commit == source_metadata["commit"], "submodule commit mismatch")
    require(source_tree == source_metadata["tree"], "canonical tree mismatch")
    require(
        sha256(source_path / "SKILL.md") == source_metadata["skill_sha256"],
        "canonical SKILL.md checksum mismatch",
    )

    catalog_gitlink = run(["git", "ls-tree", "HEAD", "--", catalog_path], cwd=ROOT)
    require(source_metadata["commit"] in catalog_gitlink, "catalog gitlink mismatch")

    openskills = f"openskills@{install_metadata['openskills_version']}"
    with tempfile.TemporaryDirectory(prefix="skills-release-readback-") as temp_dir:
        temp_root = Path(temp_dir)
        materialized = temp_root / name
        run(
            ["git", "clone", "--quiet", "--no-checkout", str(source_path), str(materialized)],
            cwd=ROOT,
        )
        run(
            ["git", "checkout", "--quiet", "--detach", source_metadata["commit"]],
            cwd=materialized,
        )
        require(
            run(["git", "rev-parse", "HEAD^{tree}"], cwd=materialized)
            == source_metadata["tree"],
            "materialized catalog tree mismatch",
        )

        consumer = temp_root / "consumer"
        consumer.mkdir()
        run(
            ["npx", "--yes", openskills, "install", str(materialized), "-u", "-y"],
            cwd=consumer,
        )
        installed = consumer / ".agent" / "skills" / install_metadata["directory"]
        require(installed.is_dir(), "openskills install directory is missing")
        installed_commit = run(["git", "rev-parse", "HEAD"], cwd=installed)
        installed_tree = run(["git", "rev-parse", "HEAD^{tree}"], cwd=installed)
        require(installed_commit == source_metadata["commit"], "installed commit mismatch")
        require(installed_tree == source_metadata["tree"], "installed tree mismatch")
        require(
            sha256(installed / "SKILL.md") == source_metadata["skill_sha256"],
            "installed SKILL.md checksum mismatch",
        )
        readback = run(
            ["npx", "--yes", openskills, "read", install_metadata["directory"]],
            cwd=consumer,
        )
        require(f"name: {name}" in readback, "installed skill readback name mismatch")

    print(
        f"representative release valid: {name}@{manifest['version']} "
        f"commit={source_commit} tree={source_tree}"
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyError, OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"representative release verification failed: {error}", file=sys.stderr)
        raise SystemExit(1)
