"""Dependency-free YAML-ish frontmatter parser.

This parser intentionally supports only the small YAML subset used by this repo:
- mappings (key: value)
- sequences (- item)
- nested blocks via indentation
- simple scalars: strings, bools, null, numbers
- flow sequences like: [Read, Write, "Quoted"]
- empty flow mapping: {}

It is NOT a full YAML implementation (no anchors/tags/multiline blocks/etc).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, List, Tuple


class YamlParseError(ValueError):
    pass


_BOOL_MAP = {"true": True, "false": False}
_NULL_SET = {"null", "none", "~"}


def safe_load(payload: str) -> dict:
    """Parse a YAML frontmatter payload into a Python mapping."""
    lines = _normalize_lines(payload)
    value, next_index = _parse_collection(lines, 0, 0)
    _skip_blanks(lines, next_index)

    if not isinstance(value, dict):
        raise YamlParseError("Frontmatter must be a mapping")
    return value


def _normalize_lines(payload: str) -> List[str]:
    # Keep line structure stable; strip trailing \r for Windows newlines.
    return [line.rstrip("\r") for line in payload.splitlines()]


def _skip_blanks(lines: List[str], index: int) -> int:
    while index < len(lines):
        stripped = lines[index].strip()
        if stripped == "" or stripped.startswith("#"):
            index += 1
            continue
        break
    return index


def _indent_of(line: str) -> int:
    if "\t" in line[: len(line) - len(line.lstrip(" \t"))]:
        raise YamlParseError("Tabs are not allowed for indentation")
    return len(line) - len(line.lstrip(" "))


def _parse_collection(lines: List[str], start: int, indent: int) -> Tuple[Any, int]:
    i = _skip_blanks(lines, start)
    if i >= len(lines):
        return {}, i

    if _indent_of(lines[i]) < indent:
        return {}, i

    is_seq = lines[i].lstrip().startswith("-") and _indent_of(lines[i]) == indent
    if is_seq:
        return _parse_sequence(lines, i, indent)
    return _parse_mapping(lines, i, indent)


def _parse_mapping(lines: List[str], start: int, indent: int) -> Tuple[dict, int]:
    result: dict = {}
    i = start

    while True:
        i = _skip_blanks(lines, i)
        if i >= len(lines):
            break

        line = lines[i]
        line_indent = _indent_of(line)
        if line_indent < indent:
            break
        if line_indent != indent:
            raise YamlParseError(f"Unexpected indentation at line {i + 1}")

        if line.lstrip().startswith("-"):
            raise YamlParseError(f"Unexpected sequence item in mapping at line {i + 1}")

        key, has_value, value_part = _split_mapping_line(line)

        if not has_value:
            # key: (no value) — parse nested collection if present.
            i += 1
            i2 = _skip_blanks(lines, i)
            if i2 < len(lines) and _indent_of(lines[i2]) > indent:
                nested_indent = _indent_of(lines[i2])
                value, i = _parse_collection(lines, i, nested_indent)
            else:
                value = None
                i = i2
        else:
            value = _parse_scalar(value_part)
            i += 1

        result[key] = value

    return result, i


def _parse_sequence(lines: List[str], start: int, indent: int) -> Tuple[list, int]:
    items: list = []
    i = start

    while True:
        i = _skip_blanks(lines, i)
        if i >= len(lines):
            break

        line = lines[i]
        line_indent = _indent_of(line)
        if line_indent < indent:
            break
        if line_indent != indent:
            raise YamlParseError(f"Unexpected indentation at line {i + 1}")

        stripped = line.lstrip()
        if not stripped.startswith("-"):
            break

        rest = stripped[1:].lstrip()

        if rest == "":
            # -
            i += 1
            i2 = _skip_blanks(lines, i)
            if i2 < len(lines) and _indent_of(lines[i2]) > indent:
                nested_indent = _indent_of(lines[i2])
                value, i = _parse_collection(lines, i, nested_indent)
                items.append(value)
            else:
                items.append(None)
                i = i2
            continue

        # Support "- key: value" as a mapping item.
        if _looks_like_mapping_pair(rest):
            key, has_value, value_part = _split_mapping_text(rest)
            mapping_item: dict = {}
            if has_value:
                mapping_item[key] = _parse_scalar(value_part)
                i += 1
            else:
                i += 1
                i2 = _skip_blanks(lines, i)
                if i2 < len(lines) and _indent_of(lines[i2]) > indent:
                    nested_indent = _indent_of(lines[i2])
                    nested_value, i = _parse_collection(lines, i, nested_indent)
                    mapping_item[key] = nested_value
                else:
                    mapping_item[key] = None
                    i = i2

            # Merge any additional mapping keys for this list item.
            i2 = _skip_blanks(lines, i)
            if i2 < len(lines) and _indent_of(lines[i2]) > indent:
                nested_indent = _indent_of(lines[i2])
                extra, i = _parse_mapping(lines, i2, nested_indent)
                mapping_item.update(extra)
            else:
                i = i2

            items.append(mapping_item)
            continue

        items.append(_parse_scalar(rest))
        i += 1

    return items, i


_KEY_RE = re.compile(r"^[A-Za-z0-9_./-]+$")


def _split_mapping_line(line: str) -> Tuple[str, bool, str]:
    # Expects already aligned indentation.
    text = line.strip()
    return _split_mapping_text(text)


def _split_mapping_text(text: str) -> Tuple[str, bool, str]:
    if ":" not in text:
        raise YamlParseError(f"Invalid mapping line: {text!r}")

    key_part, rest = text.split(":", 1)
    key = key_part.strip()
    if not key or not _KEY_RE.match(key):
        raise YamlParseError(f"Invalid key: {key!r}")

    value_part = rest.lstrip()
    if value_part == "":
        return key, False, ""
    return key, True, value_part


def _looks_like_mapping_pair(text: str) -> bool:
    # Very small heuristic: KEY: ... (KEY is simple token).
    if ":" not in text:
        return False
    key_part = text.split(":", 1)[0].strip()
    return bool(key_part) and bool(_KEY_RE.match(key_part))


def _parse_scalar(token: str) -> Any:
    t = token.strip()

    if t == "{}":
        return {}
    if t == "[]":
        return []

    if t.startswith("[") and t.endswith("]"):
        return _parse_flow_sequence(t)

    # Quoted strings
    if len(t) >= 2 and ((t[0] == '"' and t[-1] == '"') or (t[0] == "'" and t[-1] == "'")):
        return _parse_quoted(t)

    low = t.lower()
    if low in _BOOL_MAP:
        return _BOOL_MAP[low]
    if low in _NULL_SET:
        return None

    if re.fullmatch(r"[-+]?\d+", t):
        try:
            return int(t)
        except Exception:
            pass

    if re.fullmatch(r"[-+]?(\d+\.\d*|\d*\.\d+)", t):
        try:
            return float(t)
        except Exception:
            pass

    return t


def _parse_quoted(token: str) -> str:
    if token[0] == "'":
        inner = token[1:-1]
        return inner.replace("''", "'")

    # Double quotes: support basic backslash escapes.
    inner = token[1:-1]
    escapes = {
        "\\\\": "\\",
        "\\\"": '"',
        "\\n": "\n",
        "\\r": "\r",
        "\\t": "\t",
    }

    def repl(match):
        return escapes.get(match.group(0), match.group(0)[1:])

    return re.sub(r"\\[\\\"nrt]", repl, inner)


@dataclass
class _FlowSplitState:
    in_single: bool = False
    in_double: bool = False


def _parse_flow_sequence(token: str) -> List[Any]:
    inner = token.strip()[1:-1].strip()
    if inner == "":
        return []

    parts = _split_flow_items(inner)
    return [_parse_scalar(part) for part in parts]


def _split_flow_items(inner: str) -> List[str]:
    parts: List[str] = []
    buf: List[str] = []
    state = _FlowSplitState()

    i = 0
    while i < len(inner):
        ch = inner[i]

        if ch == "'" and not state.in_double:
            state.in_single = not state.in_single
            buf.append(ch)
            i += 1
            continue
        if ch == '"' and not state.in_single:
            state.in_double = not state.in_double
            buf.append(ch)
            i += 1
            continue

        if ch == "," and not state.in_single and not state.in_double:
            part = "".join(buf).strip()
            if part != "":
                parts.append(part)
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    if state.in_single or state.in_double:
        raise YamlParseError("Unterminated quoted string in flow sequence")

    tail = "".join(buf).strip()
    if tail != "":
        parts.append(tail)

    return parts
