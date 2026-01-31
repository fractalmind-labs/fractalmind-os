# OpenClaw Gateway macOS Wrapper App (Full Disk Access)

This folder contains a minimal macOS `.app` wrapper you can grant **Full Disk Access (FDA)** to, so the OpenClaw gateway can read `~/Library/Messages/chat.db` for the iMessage channel.

This is based on the workaround described in https://github.com/openclaw/openclaw/issues/5211.

## Why this exists

On newer macOS versions, FDA/TCC permissions are not reliably applied to “raw” binaries (like `node` or a CLI entrypoint) when running under `launchd`. A `.app` bundle is the most reliable target for granting FDA.

## What’s included

- `OpenClaw.app/Contents/Info.plist`: minimal Info.plist for a background UI-less app.
- `OpenClaw.app/Contents/MacOS/OpenClaw`: launcher script that runs the `openclaw` CLI via Node.
- `scripts/install-to-applications.sh`: copies the app to `/Applications`, codesigns, and clears quarantine.

## Install (on the macOS gateway host)

1. Ensure OpenClaw is installed globally (example):
   - `npm install -g openclaw@latest`

2. From this repo, install the wrapper app:
   - `bash openclaw-gateway-app/scripts/install-to-applications.sh`

3. Grant Full Disk Access to:
   - `/Applications/OpenClaw.app`
   - the Node binary you run OpenClaw with (often `/opt/homebrew/bin/node`)

4. If you run via `launchd`, update your plist to use the wrapper binary, e.g.:
   - Program: `/Applications/OpenClaw.app/Contents/MacOS/OpenClaw`
   - Args: `gateway --port 18789` (plus your normal flags)

5. Reload the service and verify:
   - `openclaw doctor`

## Notes

- The launcher supports both Apple Silicon and Intel macs.
- If your OpenClaw install path differs (not Homebrew Node, not global npm), set env vars in the launchd plist:
  - `OPENCLAW_NODE=/path/to/node`
  - `OPENCLAW_ENTRY=/path/to/openclaw.mjs`
