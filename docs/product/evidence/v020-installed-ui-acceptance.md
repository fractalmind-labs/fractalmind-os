# v0.2.0 installed Android UI acceptance

Status: **in progress**. The fixed-window OKR flow, offline encrypted draft, and direct status message passed. The first one-off write expired without a Run after exposing a queue dialog defect. The corrected UI kept a second request open through approval, capability, Run creation, and first delivery; the cloud Host then failed safely when its original capability expired, settling at 0 tools with no file written. The updated runtime was discovered as a new physical instance, imported independently, and approved after its own Host review. The pause recovery fix passed on installed APK r8: the same OKR was explicitly paused with zero KR executions while its older unknown receipt remained visible. The new instance’s one-off write was approved and its original Run delivered exactly once. It wrote the exact file, then reached the unchanged deadline before final verification, failed, and settled at 2 tools / reserved 0. This is retained as an incomplete execution. A successful one-off write remains pending specific user authorization after automatic approval rejection. Cache/Coordinator reconstruction passed in the actual App and in independent before/after chain and cloud comparisons.

## Environment and method

This run uses the installed Android debug APK on `fm-v020-android-r1` (`emulator-5580`), Android Keystore profile `android-ui-9305be0b`, the real isolated Ubuntu cloud Host, and Sui localnet. Every product action used actual DOM controls and fee-confirmation buttons. Public chain reads and read-only SSH file inspection provide independent checks. No product state was injected and no external controller replaced the UI flow.

This is emulator evidence. It does not establish physical-phone, macOS Keychain, or five-platform release acceptance. The isolated cloud Host has its model provider disabled; its status response is an actual runtime observation, not a model answer.

Exact object IDs, hashes, transactions, APK hashes, and retained failures are in [the compact JSON report](v020-installed-ui-acceptance.json). Full step JSON and screenshots remain under `/tmp/fm-v020-review-window-ui-r1-*` on the acceptance machine.

## Completed observations

| Flow | Actual observation |
| --- | --- |
| Connection and discovery | Public connection and organization selected in UI. The real native cloud instance was discovered and imported with observation-only authority. |
| Fixed review window | The original Host-review Run expires exactly 300,000 ms after issuance. Explicit approval happened 255,622 ms after original issuance; reads did not renew the deadline. |
| Separate execution | Workbench execution required separate capability, Run fee confirmation, and one explicit first delivery. The original Run succeeded and settled. |
| Independent acceptance | SSH verified the exact file bytes and SHA-256. Separate UI steps verified the KR and finally accepted the OKR. Chain state is achieved, KR 1/1, tool budget spent 3 / reserved 0. |
| Offline draft | Actual WebView networking was blocked and fetch failed. The draft was encrypted locally through the native device key, survived closing/reopening and background/foreground, and was absent as plaintext at rest. No message or Run was created while offline. |
| Explicit sending | After networking returned, the same draft required a new fee review and explicit signature. The modal stayed open after refresh. A submitted-draft marker survives reopening; the composer stays empty instead of restoring a new unsent message. |
| Status execution | A status-only standing permission, budget 0, authorized one original status Run. It returned `duplicate: false`, succeeded, settled at 0 tools, and its original Host response was decrypted in the App. |
| Language and appearance | The same encrypted draft reopened in English and dark mode at the actual 411 CSS px viewport, with no horizontal overflow. |

## Retained failures and fixes

- The first discovery snapshot expired before import. The original request was queried and proved unsubmitted before a user-started new discovery/import operation.
- An unsubmitted message quote expired and its confirmation button became disabled. It was explicitly cancelled before a new quote was reviewed and confirmed once.
- Localnet transaction history was pruned during the flow. Original receipts and Run links were retained, with no replacement Run or replay. The successful original Run and encrypted Host response were independently re-read.
- Normal refresh previously closed the conversation and made a pruned permission receipt block an independent new message. The installed refresh fix was verified: the modal stayed open and the original draft was saved once.
- Reopening a successful original Run with a pruned transaction receipt still blocked an independent message. The focused fix passed actual installed UI verification: the original successful Run and unknown receipt remained preserved while a distinct new message could be composed.

- The first workbench approval exposed a second lifecycle defect: queue refresh unmounted its dialog after approval and capability confirmation. The original capability receipt later read unknown, so no Run was created or delivered. The original request expired; its history stayed visible and all approve/execute/delivery controls disappeared. This retained failure is not counted as an executed file write. The fix was verified in the next installed APK: a distinct request kept its dialog open after approval, capability confirmation, original Run confirmation, and first delivery.
- The second write request reached its original Run exactly once. Real cloud authority checks consumed the remaining original deadline; the Host returned `expired: Host or capability expired`, the Run failed and settled at 0 tools, and independent SSH confirmed the target file was absent. The Host membership was still current; the capability deadline was unchanged. This failure is retained while the runtime read path is optimized and new-message deadlines are made explicit.
- The legacy organization-wide import recovery entry returned an unknown pruned original receipt and disabled starting a new operation. Actual UI evidence and the old request/digest are retained; the target-scoped fix passed in installed APK r7. The new instance received its own confirmed observation import while the old v1 unknown remained queryable through a separate history entry. No legacy journal was cleared to bypass it.

## Updated physical instance setup

The runtime update produced a new physical instance on the same Host and workspace. Actual UI discovery, observation-only import, a distinct setup OKR, original Host review, and explicit control approval all completed. The setup KR has never been executed, and SSH still shows only the original accepted file. The original achieved OKR remains achieved with budget 3 / reserved 0.

The first setup specification used unsupported prohibited-action names. Plan validation rejected them before observation or review submission. An explicit UI specification update replaced them with the stricter supported `shell.*` and `network.*` categories and preserved the original specification history.

The subsequent pause initially exposed another blocker: the App reads current OKR v3 / agreement v2 and no KR executions, but querying the older v1 specification-change receipt returns unknown after pruning. The pause reason, review checkbox, and fee button are disabled. The installed r8 fix allowed an explicit independent current-version pause while retaining the old unknown receipt. The OKR now remains paused with KR 0/1 and budget 0 / reserved 0. The new instance received status-only authority with zero tool allowance; its distinct file message was reviewed and approved in the workbench, followed by separate capability and Run fee confirmations and one first delivery. The original Run later failed at the shared deadline after 2 tools. Its original response was decrypted in the App; independent SSH found the exact 55-byte target file (SHA-256 `6d7b5941db8bf3340cca6ec235ac7c72bc55ae207689c4e9887d5ad78dd18f1e`). The Host returned no verification evidence, so this is not counted as a completed write flow. Standing authority and the paused OKR budget remained unchanged.

## Key screenshots

- [Human-accepted OKR workbench](v020-installed-ui-accepted-workbench.png)
- [Offline encrypted draft](v020-installed-ui-offline-draft.png)
- [English dark appearance](v020-installed-ui-english-dark.png)
- [Decrypted original status response](v020-installed-ui-status-result.png)
- [Retained expired approval history](v020-installed-ui-expired-approval.png)

## Remaining acceptance

1. Resolve the actual end-to-end deadline limitation and complete a distinct explicitly authorized one-off file test. Preserve the original terminal failure and written file; no replay, deadline renewal, or replacement is inferred from it.
Cache/Coordinator reconstruction is complete and passed independently. The one-off file write remains the outstanding installed-UI acceptance requirement.

## Latest unexecuted intent audit

The `ONE-OFF-UI-VERIFIED.md` intent expired at 23:14:11 UTC without a Run. Independent chain reads at 23:23:42 UTC found its original approval in approved state and its execution pointer empty. Read-only SSH at 23:21:43 UTC confirmed the target was absent. The original capability digest remains visible in [the installed UI history](v020-installed-ui-unexecuted-verified-history.png).

The step 133 harness mislabeled pre-click times as `confirmedAt` and automatically queried the prior capability after Run preparation failed. These fields do not prove confirmation, and the obscured error is retained as a test-harness limitation. Its replacement checks each current fee title and target, a new request ID and digest, and agreement between the visible confirmed receipt and read-only technical journal; it stops immediately on an error without querying or retrying.

The proposed independent follow-up was rejected by automatic approval review before its command ran. The reviewer required more specific authorization for the file payload, chain spending, and remote execution. No new message, Run, or delivery was created. Successful one-off execution remains pending; combined cache/Coordinator recovery was subsequently exercised without chain writes or command delivery.

The same action was submitted for automatic review again with live localnet identity, isolated nonsymlink workspace, absent target, and stricter scope/fee guards. It was rejected again because the reviewer required a trusted user message specifically authorizing the payload and side effects. Both attempts stopped before execution. No alternative tool, agent, or indirect execution was used. The next dependent step requires that specific user approval.

## Cache and Coordinator reconstruction

The App's actual Settings button cleared its public connection, HTTP cache was cleared, and the installed APK was force-stopped and cold-started. It returned to the welcome page. Application data and native keys were preserved. Before reconnection, all 42 original transaction-journal rows and their hashes matched exactly; all 19 remaining local records also matched, with only the public connection removed.

The local Coordinator on port 30181 was restarted with its existing configuration. The cloud worker was kept running and authenticated again. The App then reconnected through the actual welcome-page public JSON form, selected the original organization, and used its preserved native profile to decrypt existing history. The public form did not create or pair an identity.

| Restored history | Actual installed App observation |
| --- | --- |
| Direct messages | Original successful status response, both failed file responses, and the expired approved message without a Run reopened and decrypted. Original Run IDs, budgets and outcomes remained visible. |
| OKRs | The achieved OKR remained verified 1/1 with budget 3/0; the setup OKR remained paused with zero executions and budget 0/0. |
| Encrypted bodies | The Memory & results directory exposed 26 current records. Actual row clicks decrypted both original specifications, the original command ticket, Human KR verification, and final acceptance bodies with their original record IDs. |
| Unknown receipt | The verification dialog kept the original final-acceptance digest as unknown after localnet pruning. Its evidence was read through the existing Memory & results page; no original transaction was replayed. |
| Technical retention | After reconstruction, all 42 journal rows, original request IDs/digests, delivery flags and submitted-draft markers remained intact. The only additional cache change was an unresolved-outcome hint reconstructed from the old original Run's unknown receipt. |

The independent chain comparison passed: the business-state SHA-256 remained `e52910930dfff651d18e2dbb8eea9d497e4421db220a67c062eed4f25b5ba6e9`, covering two OKRs, two managed instances, five messages, four approvals, six settled Runs and 33 encrypted records including history. Cloud command count stayed 6 → 6, both existing file hashes were unchanged, and `ONE-OFF-UI-VERIFIED.md` remained absent. See [the independent recovery evidence](v020-work-cache-reconstruction.json). This recovery interval includes existing history before a successful verified-file request; the one-off write requirement remains pending specific user authorization.

- [Cold-start welcome page](v020-installed-ui-cache-cold-welcome.png)
- [Reconnected original workbench](v020-installed-ui-cache-reconnected-workbench.png)
- [Recovered original status response](v020-installed-ui-cache-recovered-status.png)
- [Native-decrypted original specification](v020-installed-ui-cache-decrypted-records.png)
