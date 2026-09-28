#!/usr/bin/env python3
"""Prevent deprecated Sui JSON-RPC transports returning to active consumers."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROOTS = (
    "protocols/fractalmind-protocol/sdk/",
    "protocols/fractal-demail/",
    "runtime/fractalmind-envd/",
    "runtime/fractalbot/",
    "apps/explorer/",
    ".github/workflows/",
)
PATTERNS = (
    re.compile(r"\bnew\s+(?:SuiClient|SuiJsonRpcClient)\s*\("),
    re.compile(r"@mysten/sui/(?:jsonRpc|json-rpc)"),
    re.compile(r"\bgetFullnodeUrl\s*\("),
    re.compile(r'"github.com/block-vision/sui-go-sdk/sui"'),
    re.compile(r'''["'](?:suix_|sui_|unsafe_)(?:get|query|multiGet|execute|dryRun|devInspect|moveCall|transfer|pay)[A-Za-z]*["']'''),
    re.compile(r'''["']jsonrpc["']\s*:'''),
)
failures = []
# Include new files in local checks as well as tracked files in CI.
files = subprocess.check_output(
    ["git", "ls-files", "--cached", "--others", "--exclude-standard"], cwd=ROOT, text=True
).splitlines()
for name in files:
    if not name.startswith(ROOTS) or name.endswith(("_test.go", ".test.ts", ".test.tsx")):
        continue
    path = ROOT / name
    if path.suffix not in {".go", ".ts", ".tsx", ".js", ".sh", ".yml"} or not path.is_file():
        continue
    for number, line in enumerate(path.read_text().splitlines(), 1):
        if any(pattern.search(line) for pattern in PATTERNS):
            failures.append(f"{name}:{number}: deprecated Sui JSON-RPC transport: {line.strip()}")

for name in ("protocols/fractalmind-protocol/sdk/package.json", "apps/explorer/package.json"):
    dependency = json.loads((ROOT / name).read_text()).get("dependencies", {}).get("@mysten/sui")
    if dependency and int(re.search(r"\d+", dependency).group()) < 2:
        failures.append(f"{name}: @mysten/sui must use the Core API from version 2+")

if failures:
    raise SystemExit("\n".join(failures))
print("Sui transport migration check passed.")
