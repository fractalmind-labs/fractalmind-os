# Sui organization projection — v0.2.0

Use this mode only for a FractalMind chain-backed OKR. File-only projects may keep the ordinary templates. Keep provenance beside each projected Objective; use actual complete IDs when exporting. Example field names below describe the contract, not an implemented automatic file synchronizer.

```yaml
mode: sui_projection
network: localnet
original_package_id: "{full_original_package_id}"
organization_id: "{full_org_id}"
okr_id: "{full_okr_id}"
source_version: "12"
agreement_version: "4"
spec_record_id: "{full_record_id}"
spec_revision: "2"
chain_read_at_ms: "1790848800000"
local_edit_state: CLEAN # changed local text becomes UNSUBMITTED
chain_state: ACTIVE
next_kr: "1" # zero-based; currently working on the second KR
```

## Objective and success criteria

Deliver two approved text artifacts in the managed workspace. Each file must match its agreed SHA-256, both KRs must be verified, and a human must separately accept the final result.

| Field | KR0 | KR1 |
| --- | --- | --- |
| Outcome / deliverable | Approved README bytes / README.md | Approved final bytes / FINAL.md |
| Unit / scale | verified file / 1 | verified file / 1 |
| Baseline / target | 0 / 1 | 0 / 1 |
| Direction / weight | increase / 1 | increase / 1 |
| Current / sampled_at_ms | 1 / 1790848740000 | unknown / null |
| max_age_ms | 3600000 | 3600000 |
| Evidence method | Host file read and expected hash | Host file read and expected hash |
| Run / evidence ID | actual successful Run / immutable result | none yet |
| Observation / verification | measured / human verified | no sample / unverified |

All integer values are u64 decimal strings in structured interchange. A stale value remains a historical sample and yields unknown current progress. Decreasing metrics use baseline greater than target. A missing sample is not zero. Map human-facing KR1/KR2 labels to chain indexes 0/1 explicitly.

## Execution agreement

- Managed Agent / membership: actual IDs and pinned versions from the agreement.
- Workspace / boundary: actual workspace and canonical boundary SHA-256.
- Allowed tools and paths: `file.read: ["."]`, `file.write: ["."]` as approved.
- Budget: `TOOL_CALLS`, limit `14`, confirmed spent `8`, pending `0`; include ledger read time.
- Expiry: actual chain expiry, no later than the Objective deadline.
- Escalation: pause and request approval when a proposed action exceeds the agreement; changing this file cannot grant it.

## Current heartbeat observation

```yaml
okr_id: "{same_full_okr_id}"
agreement_version: "4"
kr_index: "1"
observed_at_ms: "1790848800000"
metric:
  current: null
  sampled_at_ms: null
  unknown_reason: no_successful_run_for_current_kr
run_id: null
evidence_id: null
step: waiting_for_prepared_command
next_action: request_current_kr_command_within_approved_bounds
blocker:
  reason: no_confirmed_command_start
  since_ms: "1790848800000"
budget:
  asset: TOOL_CALLS
  limit: "14"
  spent: "8"
  reserved: "0"
  chain_read_at_ms: "1790848800000"
```

This is a local report. It does not prepare a command, confirm a start, submit a Host observation or authorize a tool. The executing envd must enforce current chain authority and checkpoints. If the Host is unreachable, show its last observation with its time and mark current state unknown.

## Edit, submit and accept

1. Read the current chain version and preserve source metadata in the projection.
2. Edit a proposal, mark it UNSUBMITTED, and retain the original source version.
3. The client checks current version and device permissions before explicit signing. A conflict is shown for review; do not silently merge or sign. If no submission interface is available, retain the proposal.
4. Query an unknown transaction by its digest. After confirmed success, re-read the chain and replace the projection. Never replay merely because a file still looks unsubmitted.
5. A revised ACTIVE Objective must pause, replace its specification and receive a newly approved agreement. Previous metric verification is cleared; historical records remain readable.
6. Host measurements remain unverified until the authorized verification transaction. All verified KRs still await a separate human acceptance transaction. Reflect ACHIEVED only after that confirmed chain result.

For private content, projection files are plaintext local work files and should be written only into the user-approved workspace. Do not export recovery codes, private keys or content keys. Durable sensitive bodies continue to use the encrypted chain record path; local reports are not replacements for it.
