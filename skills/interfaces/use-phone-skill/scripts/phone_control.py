#!/usr/bin/env python3

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

script_dir = os.path.dirname(os.path.abspath(__file__))
if script_dir not in sys.path:
    sys.path.insert(0, script_dir)

COORDINATE_CONVERSION_AVAILABLE = False

# Import coordinate conversion functions from phone_view.py (independent of timeout helpers)
try:
    from phone_view import get_accurate_screen_info, convert_relative_to_absolute, validate_coordinates
    COORDINATE_CONVERSION_AVAILABLE = True
except ImportError:
    COORDINATE_CONVERSION_AVAILABLE = False


DEFAULT_DEVICE = "127.0.0.1:5555"


KEYCODES: Dict[str, str] = {
    "back": "4",
    "home": "3",
    "menu": "82",
    "power": "26",
    "volume_up": "24",
    "volume_down": "25",
    "enter": "66",
    "delete": "67",
}


APP_PACKAGES: Dict[str, str] = {
    "settings": "com.android.settings",
    "设置": "com.android.settings",
    "browser": "com.android.browser",
    "浏览器": "com.android.browser",
    "chrome": "com.android.chrome",
    "微信": "com.tencent.mm",
    "wechat": "com.tencent.mm",
    "支付宝": "com.eg.android.AlipayGphone",
    "alipay": "com.eg.android.AlipayGphone",
    "x": "com.twitter.android",
    "twitter": "com.twitter.android",
}


def _encode_adb_text(text: str) -> str:
    # adb input text treats spaces specially; %s means space.
    # Also escape characters that have special meaning in the input tool.
    # This is not perfect for all IMEs, but is a pragmatic default.
    return (
        text.replace("%", "%25")
        .replace(" ", "%s")
        .replace("\n", "%0A")
        .replace("\t", "%09")
        .replace("&", "\\&")
        .replace("<", "\\<")
        .replace(">", "\\>")
        .replace("\"", "\\\"")
        .replace("'", "\\'")
    )


@dataclass
class CmdResult:
    ok: bool
    command: List[str]
    stdout: str
    stderr: str
    returncode: int

    def to_dict(self) -> Dict[str, Any]:
        return {
            "ok": self.ok,
            "command": self.command,
            "stdout": self.stdout if isinstance(self.stdout, str) else str(self.stdout, 'utf-8', errors='replace'),
            "stderr": self.stderr if isinstance(self.stderr, str) else str(self.stderr, 'utf-8', errors='replace'),
            "returncode": self.returncode,
        }


class AdbClient:
    def __init__(self, adb: str = "adb", device: str = DEFAULT_DEVICE, timeout_s: int = 30):
        self.adb = adb
        self.device = device
        self.timeout_s = timeout_s

    def _base(self) -> List[str]:
        return [self.adb, "-s", self.device]

    def run(self, args: Sequence[str]) -> CmdResult:
        cmd = list(args)
        try:
            p = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=self.timeout_s,
            )
            return CmdResult(
                ok=p.returncode == 0,
                command=cmd,
                stdout=p.stdout,
                stderr=p.stderr,
                returncode=p.returncode,
            )
        except subprocess.TimeoutExpired as e:
            stdout = e.stdout or ""
            stderr = (e.stderr or "") + "\nTIMEOUT"

            stderr += (
                f"\n\nCommand timed out after {self.timeout_s} seconds. "
                f"Consider increasing timeout with --timeout {self.timeout_s * 2}."
            )

            return CmdResult(
                ok=False,
                command=cmd,
                stdout=stdout,
                stderr=stderr,
                returncode=124,
            )

    def connect(self) -> CmdResult:
        return self.run([self.adb, "connect", self.device])

    def devices(self) -> CmdResult:
        return self.run([self.adb, "devices"])  # no -s; lists all

    def shell(self, *shell_args: str) -> CmdResult:
        return self.run(self._base() + ["shell", *shell_args])

    def tap(self, x: int, y: int) -> CmdResult:
        return self.shell("input", "tap", str(x), str(y))

    def swipe(self, x1: int, y1: int, x2: int, y2: int, duration_ms: Optional[int] = None) -> CmdResult:
        cmd = ["input", "swipe", str(x1), str(y1), str(x2), str(y2)]
        if duration_ms is not None:
            cmd.append(str(duration_ms))
        return self.shell(*cmd)

    def key(self, key_name_or_code: str) -> CmdResult:
        code = KEYCODES.get(key_name_or_code.lower(), key_name_or_code)
        return self.shell("input", "keyevent", str(code))

    def text(self, text: str) -> CmdResult:
        return self.shell("input", "text", _encode_adb_text(text))

    def app_start(self, package_or_alias: str) -> CmdResult:
        pkg = APP_PACKAGES.get(package_or_alias.lower(), APP_PACKAGES.get(package_or_alias, package_or_alias))
        if "." not in pkg:
            return CmdResult(
                ok=False,
                command=["app_start", package_or_alias],
                stdout="",
                stderr=f"Unknown app '{package_or_alias}'. Provide a package name like com.example.app or add alias mapping.",
                returncode=2,
            )

        # Use monkey as a generic launcher.
        return self.shell(
            "monkey",
            "-p",
            pkg,
            "-c",
            "android.intent.category.LAUNCHER",
            "1",
        )

    def app_stop(self, package_or_alias: str) -> CmdResult:
        pkg = APP_PACKAGES.get(package_or_alias.lower(), APP_PACKAGES.get(package_or_alias, package_or_alias))
        if "." not in pkg:
            return CmdResult(
                ok=False,
                command=["app_stop", package_or_alias],
                stdout="",
                stderr=f"Unknown app '{package_or_alias}'. Provide a package name like com.example.app or add alias mapping.",
                returncode=2,
            )
        return self.shell("am", "force-stop", pkg)


def _get_phone_view_script_path() -> str:
    """Get the path to phone_view.py script relative to phone_control.py"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(script_dir, "phone_view.py")

def _auto_view_screen(adb: str, device: str, timeout: int, as_json: bool = False) -> Optional[Any]:
    """
    Automatically capture and describe screen after operation.

    Args:
        adb: Path to adb executable
        device: Device identifier
        timeout: Timeout in seconds
        as_json: Whether to output JSON format

    Returns:
        - text mode: screen description (str) if successful, otherwise None
        - json mode: a dict under key `auto_view` to embed into the main JSON output
    """
    phone_view_path = _get_phone_view_script_path()

    try:
        cmd = [sys.executable, phone_view_path]

        # Add global arguments before subcommand
        if as_json:
            cmd.extend(["--json"])
        cmd.extend([
            "--adb", adb,
            "--device", device,
            "--timeout", str(timeout),
        ])

        # Add subcommand
        cmd.append("describe")

        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout + 10  # Give extra time for AI processing
        )

        if result.returncode == 0:
            if as_json:
                try:
                    view_data = json.loads(result.stdout)
                    return {
                        "ok": True,
                        "description": view_data.get("description", ""),
                        "raw": view_data,
                    }
                except json.JSONDecodeError:
                    return {
                        "ok": True,
                        "description": result.stdout.strip(),
                    }
            else:
                return result.stdout.strip()
        else:
            stderr_text = result.stderr.strip()
            returncode = result.returncode

            error_output = stderr_text or (result.stdout or "").strip() or f"returncode={returncode}"
            timeout_error = "timeout" in error_output.lower() or "timed out" in error_output.lower()

            if as_json:
                return {
                    "ok": False,
                    "error": error_output,
                    "returncode": returncode,
                    "timeout_error": timeout_error,
                    "suggested_timeout": (timeout * 2) if timeout_error else None,
                }
            else:
                if timeout_error:
                    print(
                        f"Auto-view failed: {error_output}. Consider increasing timeout with --timeout {timeout * 2}.",
                        file=sys.stderr,
                    )
                else:
                    print(f"Auto-view failed: {error_output}", file=sys.stderr)
            return None

    except subprocess.TimeoutExpired as e:
        error_msg = f"Auto-view timeout after {timeout} seconds"

        if as_json:
            return {
                "ok": False,
                "timeout_error": True,
                "error": error_msg,
                "suggested_timeout": timeout * 2,
            }
        else:
            print(f"{error_msg}. Consider increasing timeout with --timeout {timeout * 2}.", file=sys.stderr)
        return None
    except FileNotFoundError:
        if as_json:
            return {
                "ok": False,
                "error": f"phone_view.py not found at {phone_view_path}",
            }
        else:
            print(f"phone_view.py not found at {phone_view_path}", file=sys.stderr)
        return None
    except Exception as e:
        if as_json:
            return {
                "ok": False,
                "error": str(e),
            }
        else:
            print(f"Auto-view error: {e}", file=sys.stderr)
        return None


def _print_result(result: CmdResult, as_json: bool, auto_view_desc: Optional[Any] = None) -> None:
    """
    Print command result with optional auto-view description.

    Args:
        result: Command execution result
        as_json: Whether to output JSON format
        auto_view_desc: Optional screen description from auto-view
    """
    if as_json:
        output_data = result.to_dict()
        if auto_view_desc is not None:
            if isinstance(auto_view_desc, dict):
                output_data["auto_view"] = auto_view_desc
            else:
                output_data["auto_view_description"] = auto_view_desc
        print(json.dumps(output_data, ensure_ascii=False))
        return

    # Print main result
    if result.ok:
        if result.stdout.strip():
            print(result.stdout.rstrip())
    else:
        if result.stdout.strip():
            print(result.stdout.rstrip())
        if result.stderr.strip():
            print(result.stderr.rstrip(), file=sys.stderr)
        sys.exit(result.returncode or 1)

    # Print auto-view description if available
    if auto_view_desc:
        print(f"\n--- Screen View ---")
        print(auto_view_desc)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="phone_control.py",
        description="ADB-based phone control (non-interactive).",
    )
    p.add_argument("--adb", default="adb", help="Path to adb (default: adb)")
    p.add_argument("--device", default=DEFAULT_DEVICE, help=f"ADB device serial (default: {DEFAULT_DEVICE})")
    p.add_argument("--timeout", type=int, default=200, help="Command timeout in seconds (default: 200)")
    p.add_argument("--json", action="store_true", help="Print machine-readable JSON output")
    auto_view_group = p.add_mutually_exclusive_group()
    auto_view_group.add_argument(
        "--auto-view",
        dest="auto_view",
        action="store_true",
        help="Automatically capture and describe screen after operation (default: enabled)",
    )
    auto_view_group.add_argument(
        "--no-auto-view",
        dest="auto_view",
        action="store_false",
        help="Disable automatic screen capture/description after operations",
    )
    p.set_defaults(auto_view=True)
    p.add_argument("--wait", type=float, default=1.5, help="Wait time in seconds before auto-view (default: 1.5)")

    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("connect", help="adb connect <device>")
    sub.add_parser("devices", help="List devices")

    tap_p = sub.add_parser("tap", help="Tap at coordinates")
    tap_p.add_argument("x", type=int, help="X coordinate (absolute pixels or relative if --relative)")
    tap_p.add_argument("y", type=int, help="Y coordinate (absolute pixels or relative if --relative)")
    tap_p.add_argument("--relative", action="store_true", help="Treat coordinates as relative (0-999) instead of absolute pixels")

    swipe_p = sub.add_parser("swipe", help="Swipe from (x1,y1) to (x2,y2)")
    swipe_p.add_argument("x1", type=int, help="Start X coordinate (absolute pixels or relative if --relative)")
    swipe_p.add_argument("y1", type=int, help="Start Y coordinate (absolute pixels or relative if --relative)")
    swipe_p.add_argument("x2", type=int, help="End X coordinate (absolute pixels or relative if --relative)")
    swipe_p.add_argument("y2", type=int, help="End Y coordinate (absolute pixels or relative if --relative)")
    swipe_p.add_argument("--duration", type=int, default=None, help="Duration in ms")
    swipe_p.add_argument("--relative", action="store_true", help="Treat coordinates as relative (0-999) instead of absolute pixels")

    key_p = sub.add_parser("key", help="Send keyevent by name (back/home/...) or numeric keycode")
    key_p.add_argument("key", help="Key name or keycode")

    text_p = sub.add_parser("text", help="Type text via adb input text")
    text_p.add_argument("text", help="Text to type")

    app_p = sub.add_parser("app", help="Launch app by package name or alias")
    app_p.add_argument("name", help="Package name (com.xxx) or alias (wechat/微信/settings/...)")

    stop_p = sub.add_parser("stop", help="Force-stop app by package name or alias")
    stop_p.add_argument("name", help="Package name (com.xxx) or alias")

    shell_p = sub.add_parser("shell", help="Run raw adb shell command")
    shell_p.add_argument("shell_args", nargs=argparse.REMAINDER, help="Command after 'shell'")

    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)

    # Validate wait parameter
    if hasattr(args, 'wait') and args.wait < 0:
        print("Error: --wait time cannot be negative.", file=sys.stderr)
        return 1
    if hasattr(args, 'wait') and args.wait > 60:
        print("Error: --wait time cannot exceed 60 seconds.", file=sys.stderr)
        return 1

    # Validate relative coordinate availability
    if hasattr(args, 'relative') and args.relative and not COORDINATE_CONVERSION_AVAILABLE:
        print("Error: --relative requires coordinate conversion functions which are not available.", file=sys.stderr)
        return 1

    adb = AdbClient(adb=args.adb, device=args.device, timeout_s=args.timeout)

    # Helper function to convert relative coordinates to absolute
    def convert_coordinates_if_needed(x: int, y: int) -> tuple[int, int]:
        if not hasattr(args, 'relative') or not args.relative:
            # For absolute coordinates, still validate boundaries
            if COORDINATE_CONVERSION_AVAILABLE:
                try:
                    screen_info = get_accurate_screen_info(args.adb, args.device)
                    valid_x, valid_y, was_corrected = validate_coordinates(x, y, screen_info['width'], screen_info['height'])
                    if was_corrected:
                        print(f"⚠️ 绝对坐标已修正: ({x}, {y}) -> ({valid_x}, {valid_y})", file=sys.stderr)
                    return valid_x, valid_y
                except Exception:
                    return x, y
            return x, y

        if not COORDINATE_CONVERSION_AVAILABLE:
            print("Error: Coordinate conversion not available", file=sys.stderr)
            return x, y

        try:
            # Get screen info for conversion
            screen_info = get_accurate_screen_info(args.adb, args.device)

            # First validate relative coordinates (Open-AutoGLM style: 0-999)
            if x < 0 or x > 999 or y < 0 or y > 999:
                print(f"⚠️ 相对坐标超出范围 (0-999): ({x}, {y})", file=sys.stderr)
                x = max(0, min(999, x))
                y = max(0, min(999, y))
                print(f"✂️ 已修正相对坐标为: ({x}, {y})", file=sys.stderr)

            # Convert to absolute coordinates
            abs_x, abs_y = convert_relative_to_absolute(x, y, screen_info['width'], screen_info['height'])

            # Validate absolute coordinates
            valid_x, valid_y, was_corrected = validate_coordinates(abs_x, abs_y, screen_info['width'], screen_info['height'])

            print(f"🔄 转换相对坐标 ({x}, {y}) -> 绝对坐标 ({valid_x}, {valid_y})", file=sys.stderr)

            if was_corrected and (valid_x != abs_x or valid_y != abs_y):
                print(f"⚠️ 绝对坐标已自动修正: ({abs_x}, {abs_y}) -> ({valid_x}, {valid_y})", file=sys.stderr)

            return valid_x, valid_y

        except Exception as e:
            print(f"⚠️ 坐标转换失败，使用原始坐标: {e}", file=sys.stderr)
            return x, y

    # Helper function to handle auto-view after operations
    def execute_with_auto_view(command_func, *command_args, **command_kwargs) -> int:
        # Record start time to calculate remaining timeout
        start_time = time.time()

        result = command_func(*command_args, **command_kwargs)
        auto_view_desc = None

        if hasattr(args, 'auto_view') and args.auto_view and result.ok:
            # Auto-view only for commands that modify the screen
            auto_view_commands = {"tap", "swipe", "key", "text", "app"}
            if args.cmd in auto_view_commands:
                # Add wait time if specified
                if hasattr(args, 'wait') and args.wait > 0:
                    time.sleep(args.wait)

                # Calculate remaining timeout for auto-view
                elapsed_time = time.time() - start_time
                # elapsed_time already includes the wait time (since wait is executed before this point)
                # So we don't need to subtract wait time again
                remaining_timeout = max(10, args.timeout - elapsed_time)  # Minimum 10 seconds for auto-view

                auto_view_desc = _auto_view_screen(
                    adb=args.adb,
                    device=args.device,
                    timeout=int(remaining_timeout),
                    as_json=args.json
                )

        _print_result(result, args.json, auto_view_desc)
        return 0 if result.ok else result.returncode or 1

    if args.cmd == "connect":
        _print_result(adb.connect(), args.json)
        return 0

    if args.cmd == "devices":
        _print_result(adb.devices(), args.json)
        return 0

    if args.cmd == "tap":
        # Convert coordinates if needed
        abs_x, abs_y = convert_coordinates_if_needed(args.x, args.y)
        return execute_with_auto_view(adb.tap, abs_x, abs_y)

    if args.cmd == "swipe":
        # Convert coordinates if needed
        abs_x1, abs_y1 = convert_coordinates_if_needed(args.x1, args.y1)
        abs_x2, abs_y2 = convert_coordinates_if_needed(args.x2, args.y2)
        return execute_with_auto_view(adb.swipe, abs_x1, abs_y1, abs_x2, abs_y2, args.duration)

    if args.cmd == "key":
        return execute_with_auto_view(adb.key, args.key)

    if args.cmd == "text":
        return execute_with_auto_view(adb.text, args.text)

    if args.cmd == "app":
        return execute_with_auto_view(adb.app_start, args.name)

    if args.cmd == "stop":
        _print_result(adb.app_stop(args.name), args.json)
        return 0

    if args.cmd == "shell":
        if not args.shell_args:
            print("No shell command provided.", file=sys.stderr)
            return 2
        _print_result(adb.shell(*args.shell_args), args.json)
        return 0

    print(f"Unknown command: {args.cmd}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
