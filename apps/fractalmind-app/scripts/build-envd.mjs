// Builds the bundled envd sidecar for the Tauri target triple (#64). Tauri
// copies src-tauri/binaries/fractalmind-envd-<triple> next to the App binary.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envd = resolve(app, "../../runtime/fractalmind-envd");
const triple =
  process.env.TAURI_ENV_TARGET_TRIPLE ||
  /host: (\S+)/.exec(execFileSync("rustc", ["-vV"], { encoding: "utf8" }))[1];
const arch = { x86_64: "amd64", aarch64: "arm64" }[triple.split("-")[0]];
const os = triple.includes("apple-darwin")
  ? "darwin"
  : triple.includes("windows")
    ? "windows"
    : triple.includes("linux")
      ? "linux"
      : null;
if (!arch || !os) throw new Error(`No envd sidecar for ${triple}`);
const version = JSON.parse(
  readFileSync(join(app, "src-tauri/tauri.conf.json"), "utf8"),
).version;
const out = join(
  app,
  "src-tauri/binaries",
  `fractalmind-envd-${triple}${os === "windows" ? ".exe" : ""}`,
);
mkdirSync(dirname(out), { recursive: true });
execFileSync(
  "go",
  ["build", "-trimpath", "-ldflags", `-s -w -X main.version=${version}`, "-o", out, "./cmd/envd"],
  {
    cwd: envd,
    stdio: "inherit",
    // The macOS Keychain store needs cgo; other platforms use pure Go stores.
    env: { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: os === "darwin" ? "1" : "0" },
  },
);
console.log(`envd sidecar: ${out}`);
