# Agent inbox protocol (version 1)

An inbox is a directory that holds deliveries for one agent until a consumer moves them into the agent's session. FractalBot writes inboxes for `claudeDesktop` agents. The relay inside each Claude Desktop session consumes them. Any other process may produce or consume an inbox by following these rules. The reference implementation is `pkg/localruntime`.

## Layout

```
<dataDir>/inbox/<agent>/
├── <name>.json        queued envelopes
├── done/              delivered envelopes, kept for inspection
├── failed/            envelopes the consumer could not read
└── .relay.lock/       present while a consumer holds the inbox
    └── owner.json
```

- Directories are mode `0700`, and files are mode `0600`. Both are owned by the user that runs FractalBot.
- Consumers ignore names that start with `.` and anything that is not a regular `.json` file.

## Envelope file

```json
{
  "version": 1,
  "envelope": {
    "id": "5f0c…",
    "received_at": "2026-10-20T01:11:00.123Z",
    "source": "heartbeat",
    "job_id": "xiaoyi-heartbeat",
    "run_id": "1632…",
    "scheduled_at": "2026-10-20T01:11:00Z",
    "expires_at": "2026-10-21T01:11:00Z",
    "coalesce_key": "heartbeat:xiaoyi-heartbeat",
    "channel": "heartbeat",
    "selected_agent": "xiaoyi-desktop",
    "text": "…"
  },
  "prompt": "the complete text the agent receives"
}
```

- `prompt` is what the consumer delivers. `envelope` is routing context for diagnostics and filtering. Its fields match `localruntime.Envelope`.
- Producers write each file atomically: write a temporary file whose name starts with `.` inside the inbox, then rename it to its final name.
- A file without `version` is version 1. A consumer must refuse a version newer than it understands and move the file to `failed/`.
- Files larger than 4 MiB are invalid.

## Names and ordering

- A message is named `<UTC time as 20060102T150405.000000000Z>-<id>.json`. Consumers deliver in name order, which is arrival order.
- A delivery with a `coalesce_key` is named `heartbeat-<first 12 bytes of SHA-256(key), hex>.json`. A newer wakeup for the same schedule therefore replaces one that is still waiting, rather than queuing behind it.

## Consuming

1. **Take the lock.** Create `.relay.lock` with `mkdir`, then write `owner.json` as `{"pid": <consumer pid>, "socket_path": "<session socket>"}`.
   - The lock is live while that process runs and the socket path is still a socket. If the lock is live, another consumer holds the inbox, so stop.
   - A stale lock may be removed and taken.
   - Producers read the lock to report presence: an agent with a live lock is online.
2. **Deliver queued envelopes in name order.**
   - After the session accepts an envelope, rename the file into `done/`.
   - Move an unreadable or invalid file into `failed/`.
   - If the session cannot be reached, stop the pass and leave the remaining files queued.
3. **Release the lock on exit.** Remove `.relay.lock`, but only if `owner.json` still names this process.

Delivery is at least once. A consumer that crashes after the session accepts an envelope, but before renaming the file, delivers it again on its next pass.
