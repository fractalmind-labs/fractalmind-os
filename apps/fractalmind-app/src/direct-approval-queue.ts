import type { FractalMindSDK } from "@fractalmind-labs/fractalmind-sdk";
import type { ChainReadSession } from "./chain";
import type { Agent, ReadSection } from "./domain";

type Direct = FractalMindSDK["directAgent"];
type Permission = Awaited<ReturnType<Direct["getPermission"]>>;
type Message = Awaited<ReturnType<Direct["getMessage"]>>;
type Approval = Awaited<ReturnType<Direct["getApproval"]>>;
type Run = Awaited<ReturnType<FractalMindSDK["nodeExecution"]["getExecution"]>>;
export type DirectApprovalRow = {
  managed: Agent;
  permission: Permission;
  message: Message;
  approval: Approval;
  executionId: string | null;
  run: ReadSection<Run | null>;
};
export type DirectApprovalQueue = {
  rows: DirectApprovalRow[];
  unavailableAgents: string[];
  loadedAtMs: number;
};
const pin = (value: unknown) => JSON.stringify(value);
const invalid = () => new Error("invalid_direct_approval_source");

/** Public chain metadata only. Reading or opening a row cannot grant authority,
 * decrypt a message, sign, pay, prepare a Run or deliver a command. The native
 * conversation independently rechecks current authority on explicit action. */
export async function readDirectApprovalQueue(
  chain: ChainReadSession,
  organizationId: string,
  agents: Agent[],
): Promise<DirectApprovalQueue> {
  await chain.checkNetwork();
  const rows: DirectApprovalRow[] = [],
    unavailableAgents: string[] = [];
  const seen = new Set<string>();
  for (const managed of agents) {
    if (managed.org_id !== organizationId || seen.has(managed.id))
      throw invalid();
    seen.add(managed.id);
    try {
      const direct = chain.sdk.directAgent;
      const permission = await direct.findPermissionForAgent(
        organizationId,
        managed.id,
      );
      if (!permission) continue;
      if (
        permission.org_id !== organizationId ||
        permission.managed_agent !== managed.id
      )
        throw invalid();
      const messages = await direct.listMessages(permission.id);
      const current: DirectApprovalRow[] = [];
      for (const message of messages) {
        if (
          message.org_id !== organizationId ||
          message.managed_agent !== managed.id ||
          message.permission_id !== permission.id
        )
          throw invalid();
        const { approval, executionId } = await direct.getMessageLinks(
          message.id,
        );
        if (!approval) continue;
        if (
          approval.org_id !== organizationId ||
          approval.managed_agent !== managed.id ||
          approval.permission_id !== permission.id ||
          approval.message_id !== message.id ||
          approval.permission_version !== message.permission_version ||
          approval.managed_version !== message.managed_version ||
          approval.action !== message.action ||
          approval.budget_amount !== message.budget_amount ||
          pin(approval.boundary_hash) !== pin(message.boundary_hash)
        )
          throw invalid();
        let run: DirectApprovalRow["run"] = { value: null };
        if (executionId) {
          try {
            const value =
              await chain.sdk.nodeExecution.getExecution(executionId);
            const claim = await direct.getClaim(permission.id, executionId);
            if (
              value.id !== executionId ||
              value.org_id !== organizationId ||
              value.managed_agent !== managed.id ||
              value.host_address !== managed.host_address ||
              value.node_id !== managed.host_address ||
              value.agent_id !== managed.instance_id ||
              value.membership_id !== message.membership_id ||
              value.delegate !== message.writer_device ||
              value.human_id !== message.human_id ||
              value.grant_id !== message.grant_id ||
              value.action !== "direct.message" ||
              value.scope !== "direct" ||
              value.budget_amount !== message.budget_amount ||
              value.budget_asset !==
                (BigInt(message.budget_amount) === 0n ? "" : "TOOL_CALLS") ||
              value.state < 0 ||
              value.state > 5 ||
              ([2, 3, 4].includes(value.state) && !value.result_record) ||
              (value.result_record !== null &&
                (value.state < 2 || value.result_hash.length !== 32)) ||
              claim.message_id !== message.id ||
              claim.capability_id !== value.capability_id ||
              claim.approval_id !== approval.id ||
              claim.permission_version !== message.permission_version
            )
              throw invalid();
            if (
              pin(value) !==
              pin(await chain.sdk.nodeExecution.getExecution(executionId))
            )
              throw invalid();
            run = { value };
          } catch {
            run = { value: null, failure: "execution_unavailable" };
          }
        }
        // Decision writes mutate Approval independently of StandingPermission.
        // Pin it separately so a resolved request cannot acquire a fresh
        // timestamp while still labelled pending from the earlier read.
        if (pin(approval) !== pin(await direct.getApproval(approval.id)))
          throw invalid();
        current.push({
          managed,
          permission,
          message,
          approval,
          executionId,
          run,
        });
      }
      // A permission revision or a newly linked approval/Run changes the same
      // source object; never publish a mixed-version queue as a complete read.
      if (
        pin(permission) !==
        pin(await direct.findPermissionForAgent(organizationId, managed.id))
      )
        throw invalid();
      rows.push(...current);
    } catch {
      unavailableAgents.push(managed.id);
    }
  }
  await chain.checkNetwork();
  rows.sort((a, b) =>
    BigInt(a.message.created_at_ms) > BigInt(b.message.created_at_ms)
      ? -1
      : BigInt(a.message.created_at_ms) < BigInt(b.message.created_at_ms)
        ? 1
        : a.message.id.localeCompare(b.message.id),
  );
  return { rows, unavailableAgents, loadedAtMs: Date.now() };
}

/** A queue label is a read-time fact, never proof that this device can approve. */
export function directApprovalStatus(row: DirectApprovalRow, now: bigint) {
  if (row.approval.state === 2) return "rejected";
  if (row.approval.state === 3) return "consumed";
  if (row.executionId || row.run.failure) return "reconcile";
  if (
    row.permission.revoked ||
    row.managed.revoked ||
    !row.managed.control_confirmed ||
    row.permission.version !== row.message.permission_version ||
    row.managed.version !== row.message.managed_version ||
    row.permission.managed_version !== row.managed.version ||
    row.permission.membership_id !== row.managed.membership_id
  )
    return "superseded";
  if (
    [
      row.permission.expires_at_ms,
      row.message.expires_at_ms,
      row.approval.expires_at_ms,
    ].some((ms) => BigInt(ms) <= now)
  )
    return "expired";
  return row.approval.state === 0 ? "pending" : "approved";
}

export function directApprovalNeedsAttention(
  row: DirectApprovalRow,
  now: bigint,
) {
  return (
    ["pending", "approved", "reconcile"].includes(
      directApprovalStatus(row, now),
    ) ||
    Boolean(row.run.failure) ||
    Boolean(row.run.value && [0, 1, 3, 4].includes(row.run.value.state))
  );
}
