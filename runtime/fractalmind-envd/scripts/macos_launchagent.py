#!/usr/bin/env python3
"""Install envd as a per-user macOS LaunchAgent."""

from __future__ import annotations

import argparse
import os
import plistlib
import subprocess
import sys
import tempfile
from pathlib import Path


DEFAULT_LABEL = "ai.fractalmind.envd"
DEFAULT_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"


def build_plist(
    *,
    label: str,
    binary: Path,
    config: Path,
    log_dir: Path,
    home: Path,
) -> dict[str, object]:
    return {
        "Label": label,
        "ProgramArguments": [str(binary), "-config", str(config)],
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 5,
        "ProcessType": "Interactive",
        "LimitLoadToSessionType": "Aqua",
        "WorkingDirectory": str(config.parent),
        "EnvironmentVariables": {
            "HOME": str(home),
            "PATH": DEFAULT_PATH,
        },
        "StandardOutPath": str(log_dir / "envd.log"),
        "StandardErrorPath": str(log_dir / "envd.log"),
    }


def write_plist(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as tmp:
        plistlib.dump(payload, tmp, fmt=plistlib.FMT_XML, sort_keys=False)
        tmp_path = Path(tmp.name)
    tmp_path.chmod(0o644)
    tmp_path.replace(path)


def run_launchctl(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["launchctl", *args],
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def validate_inputs(binary: Path, config: Path) -> None:
    if not binary.is_absolute() or not config.is_absolute():
        raise ValueError("--binary and --config must be absolute paths")
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise ValueError(f"envd binary is not executable: {binary}")
    if not config.is_file():
        raise ValueError(f"envd config is not readable: {config}")


def absolute_path(raw: str) -> Path:
    return Path(os.path.abspath(os.path.expanduser(raw)))


def install(args: argparse.Namespace) -> None:
    binary = absolute_path(args.binary)
    config = absolute_path(args.config)
    log_dir = absolute_path(args.log_dir)
    validate_inputs(binary, config)
    log_dir.mkdir(parents=True, exist_ok=True)

    plist_path = Path.home() / "Library" / "LaunchAgents" / f"{args.label}.plist"
    payload = build_plist(
        label=args.label,
        binary=binary,
        config=config,
        log_dir=log_dir,
        home=Path.home(),
    )
    write_plist(plist_path, payload)
    subprocess.run(["plutil", "-lint", str(plist_path)], check=True)

    domain = f"gui/{os.getuid()}"
    run_launchctl("bootout", f"{domain}/{args.label}", check=False)
    run_launchctl("bootstrap", domain, str(plist_path))
    run_launchctl("enable", f"{domain}/{args.label}")
    run_launchctl("kickstart", "-k", f"{domain}/{args.label}")
    print(f"installed {args.label}: {plist_path}")


def uninstall(args: argparse.Namespace) -> None:
    domain = f"gui/{os.getuid()}"
    run_launchctl("bootout", f"{domain}/{args.label}", check=False)
    plist_path = Path.home() / "Library" / "LaunchAgents" / f"{args.label}.plist"
    plist_path.unlink(missing_ok=True)
    print(f"uninstalled {args.label}")


def status(args: argparse.Namespace) -> None:
    result = run_launchctl("print", f"gui/{os.getuid()}/{args.label}", check=False)
    sys.stdout.write(result.stdout)
    if result.returncode != 0:
        raise SystemExit(result.returncode)


def render(args: argparse.Namespace) -> None:
    payload = build_plist(
        label=args.label,
        binary=Path(args.binary),
        config=Path(args.config),
        log_dir=Path(args.log_dir),
        home=Path(args.home),
    )
    plistlib.dump(payload, sys.stdout.buffer, fmt=plistlib.FMT_XML, sort_keys=False)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="command", required=True)

    install_p = sub.add_parser("install")
    install_p.add_argument("--binary", required=True)
    install_p.add_argument("--config", required=True)
    install_p.add_argument("--label", default=DEFAULT_LABEL)
    install_p.add_argument("--log-dir", default="~/.local/state/fractalmind-envd")
    install_p.set_defaults(func=install)

    uninstall_p = sub.add_parser("uninstall")
    uninstall_p.add_argument("--label", default=DEFAULT_LABEL)
    uninstall_p.set_defaults(func=uninstall)

    status_p = sub.add_parser("status")
    status_p.add_argument("--label", default=DEFAULT_LABEL)
    status_p.set_defaults(func=status)

    render_p = sub.add_parser("render")
    render_p.add_argument("--binary", required=True)
    render_p.add_argument("--config", required=True)
    render_p.add_argument("--log-dir", required=True)
    render_p.add_argument("--home", required=True)
    render_p.add_argument("--label", default=DEFAULT_LABEL)
    render_p.set_defaults(func=render)
    return p


def main() -> None:
    args = parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
