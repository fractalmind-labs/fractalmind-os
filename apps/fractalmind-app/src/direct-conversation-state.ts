import type { DirectMessageView, NativeDirectAgent } from "./direct-agent";
import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";

type Description = Awaited<ReturnType<NativeDirectAgent["describe"]>>;
const sameBytes = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** A missing historical permission receipt must not permanently block a
 * distinct new message under independently verified current chain authority.
 * This does not resolve that receipt, retry its operation, or authorize a
 * message/approval/Run whose own outcome is unknown. */
export function canComposeAfterPermissionReceipt(
  description: Description | null,
  receipt: SelfPayTransactionOutcome | null,
  now: bigint,
) {
  if (
    receipt?.status !== "unknown" ||
    !description?.permission ||
    !directConversationState(description, null, now).current
  )
    return false;
  const prefix = `direct-permission:${description.managed.id}:`;
  if (!receipt.requestId.startsWith(prefix)) return false;
  const revision = receipt.requestId.slice(prefix.length);
  if (revision !== "create" && !/^[1-9][0-9]*$/.test(revision)) return false;
  return (
    BigInt(description.permission.version) >
    (revision === "create" ? 0n : BigInt(revision))
  );
}

/** Only a controller-read original successful Run, its settled direct claim,
 * and its verified/decrypted immutable result can release the new-message
 * composer. This never resolves the transaction receipt or enables replay. */
export function canComposeAfterSettledRun(
  description: Description | null,
  selected: DirectMessageView | null,
  receipt: SelfPayTransactionOutcome | null,
  now: bigint,
) {
  if (
    receipt?.status !== "unknown" ||
    !selected ||
    receipt.requestId !== `direct-run:${selected.message.id}` ||
    !directConversationState(description, null, now).current
  )
    return false;
  // NativeDirectAgent.message already resolves the exact Sui message_runs
  // pointer and reads this claim from that Run; NativeExecutionResults checks
  // original record provenance/hash, decrypts it and verifies settled spend.
  // Do not accept a linked Run alone, or a cached/undeciphered result locator.
  const { message, result, claim } = selected;
  const permission = description!.permission!;
  // Expiry of the completed original message forbids its reuse, not a
  // separate message. Current permission/member/device expiry still applies.
  if (
    message.permission_id !== permission.id ||
    message.permission_version !== permission.version ||
    message.managed_agent !== description!.managed.id ||
    message.managed_version !== description!.managed.version ||
    message.membership_id !== description!.member.id ||
    message.human_generation !== description!.humanGeneration
  )
    return false;
  if (!result || !claim || !result.response || !result.recordId) return false;
  const { run, response } = result;
  return Boolean(
    run.state === 2 &&
      run.result_record === result.recordId &&
      run.result_hash.length === 32 &&
      run.managed_agent === message.managed_agent &&
      run.org_id === message.org_id &&
      run.membership_id === message.membership_id &&
      run.host_address === description!.managed.host_address &&
      run.agent_id === description!.managed.instance_id &&
      run.action === "direct.message" &&
      run.scope === "direct" &&
      run.delegate === message.writer_device &&
      run.grant_id === message.grant_id &&
      run.budget_amount === message.budget_amount &&
      claim.settled === true &&
      claim.message_id === message.id &&
      claim.capability_id === run.capability_id &&
      claim.permission_version === message.permission_version &&
      claim.reserved === message.budget_amount &&
      response.execution_id === run.id &&
      response.execution_state === "succeeded" &&
      response.command_id === run.command_id &&
      response.ok === true &&
      response.requires_confirmation !== true,
  );
}

/** A separately renewed permission can supersede an exact old decision that
 * never produced a Run. The old receipt remains unknown; only a distinct new
 * message under the current permission becomes possible. */
export function canComposeAfterSupersededDecision(
  description: Description | null,
  selected: DirectMessageView | null,
  receipt: SelfPayTransactionOutcome | null,
  now: bigint,
) {
  if (
    receipt?.status !== "unknown" ||
    !selected?.approval ||
    ![
      `direct-decision:${selected.message.id}:true`,
      `direct-decision:${selected.message.id}:false`,
    ].includes(receipt.requestId) ||
    !directConversationState(description, null, now).current
  )
    return false;
  // message() has resolved the exact original Sui message/approval directory.
  // Missing or unreadable Run coverage throws there; only a known null is safe.
  const { message, approval } = selected,
    p = description!.permission!;
  return Boolean(
    selected.result === null &&
      selected.claim === null &&
      selected.readPermission?.id === p.id &&
      selected.readPermission.version === p.version &&
      message.permission_id === p.id &&
      message.org_id === p.org_id &&
      BigInt(message.permission_version) < BigInt(p.version) &&
      message.managed_agent === description!.managed.id &&
      message.managed_version === description!.managed.version &&
      message.membership_id === description!.member.id &&
      message.human_generation === description!.humanGeneration &&
      approval.permission_id === message.permission_id &&
      approval.permission_version === message.permission_version &&
      approval.message_id === message.id &&
      approval.org_id === message.org_id &&
      approval.managed_agent === message.managed_agent &&
      approval.managed_version === message.managed_version &&
      approval.human_generation === message.human_generation &&
      approval.action === message.action &&
      approval.budget_amount === message.budget_amount &&
      sameBytes(approval.boundary_hash, message.boundary_hash) &&
      [0, 1, 2].includes(approval.state),
  );
}

export function canComposeAfterResolvedOriginal(
  description: Description | null,
  selected: DirectMessageView | null,
  receipt: SelfPayTransactionOutcome | null,
  now: bigint,
) {
  return (
    canComposeAfterSettledRun(description, selected, receipt, now) ||
    canComposeAfterSupersededDecision(description, selected, receipt, now)
  );
}

/** Hide invalid mutation entries using the fresh description, including when
 * a historical queue row was opened. The controller still independently checks
 * all authority, directories and source versions before quoting and signing. */
export function directConversationState(
  description: Description | null,
  selected: DirectMessageView | null,
  now: bigint,
) {
  const p = description?.permission,
    managed = description?.managed,
    member = description?.member;
  const current = Boolean(
    p &&
      managed &&
      member &&
      !p.revoked &&
      !managed.revoked &&
      managed.control_confirmed &&
      !member.revoked &&
      !description!.binding.revoked &&
      managed.runtime === "bounded-process-v1" &&
      /^native-[0-9a-f]{64}$/.test(managed.instance_id) &&
      p.managed_agent === managed.id &&
      p.managed_version === managed.version &&
      p.membership_id === member.id &&
      managed.membership_id === member.id &&
      p.membership_version === member.version &&
      p.human_generation === description!.humanGeneration &&
      p.host_address === managed.host_address &&
      member.host_address === managed.host_address &&
      sameBytes(p.workspace_hash, managed.workspace_hash) &&
      BigInt(p.expires_at_ms) > now &&
      BigInt(member.expires_at_ms) > now &&
      BigInt(description!.authorityExpiresAtMs) > now,
  );
  const message = selected?.message,
    approval = selected?.approval;
  const fresh = Boolean(
    current &&
      message &&
      p &&
      message.permission_id === p.id &&
      message.permission_version === p.version &&
      message.managed_agent === managed!.id &&
      message.managed_version === managed!.version &&
      message.membership_id === member!.id &&
      message.human_generation === description!.humanGeneration &&
      BigInt(message.expires_at_ms) > now,
  );
  const approvalFresh = Boolean(
    fresh &&
      approval &&
      p &&
      message &&
      approval.message_id === message.id &&
      approval.permission_id === p.id &&
      approval.permission_version === p.version &&
      approval.managed_version === managed!.version &&
      approval.human_generation === description!.humanGeneration &&
      BigInt(approval.expires_at_ms) > now,
  );
  const approvalWorkspaceFresh = Boolean(
    approvalFresh &&
      selected &&
      approval &&
      (message!.action !== "file.write" ||
        (selected.workspace.complete &&
          selected.workspace.revision === approval.workspace_revision)),
  );
  return { current, fresh, approvalFresh, approvalWorkspaceFresh };
}
