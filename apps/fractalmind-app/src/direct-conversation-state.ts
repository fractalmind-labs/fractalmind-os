import type { DirectMessageView, NativeDirectAgent } from "./direct-agent";

type Description = Awaited<ReturnType<NativeDirectAgent["describe"]>>;
const sameBytes = (a: number[], b: number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

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
