import {
  SelfPayTransactionManager,
  type ManagedRuntime,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { Transaction } from "@mysten/sui/transactions";
import type { ChainReadSession } from "./chain";
import type { DiscoveredInstance } from "./agent-discovery";
import { DeviceIdentityVerifier } from "./device-identity";
import { hostDirectory } from "./host-admission";
import type { NativeDeviceSigner } from "./native-device";
import { awaitTransactionVisible } from "./transaction-visibility";

/** One-click import (#70): several running Agents, one transaction. */
export type BatchTarget = {
  hostAddress: string;
  bindingId: string;
  instance: DiscoveredInstance;
  /** Read from this computer (rechecked before signing) rather than from a
   * remote host's signed scan. */
  local: boolean;
};
export class BatchImportError extends Error {
  constructor(
    readonly code:
      | "none_selected"
      | "host_not_member"
      | "instance_gone"
      | "quote_changed"
      | "not_importable",
  ) {
    super(code);
  }
}

/** agent-manager Homes are imported with control (#70); other tmux sessions
 * observe only; a bounded native Agent still needs the reviewed handover. */
export function importRuntime(instance: DiscoveredInstance): {
  runtime: ManagedRuntime;
  controlConfirmed: boolean;
} {
  if (instance.runtime === "bounded-process-v1")
    return { runtime: "bounded-process-v1", controlConfirmed: false };
  return instance.agent
    ? { runtime: "agent-manager-v1", controlConfirmed: true }
    : { runtime: "tmux-observe", controlConfirmed: false };
}
export function importable(instance: DiscoveredInstance) {
  return (
    instance.state === "observed" &&
    /^(tmux|native)-[0-9a-f]{64}$/.test(instance.instanceId) &&
    /^[0-9a-f]{64}$/.test(instance.workspaceHash)
  );
}
const fromHex = (hex: string) =>
  Uint8Array.from(hex.match(/../g)!, (b) => parseInt(b, 16));

export class BatchImport {
  readonly manager: SelfPayTransactionManager;
  private verifier: DeviceIdentityVerifier;
  private plans = new Map<SelfPayFeeQuote, BatchTarget[]>();
  constructor(
    readonly chain: ChainReadSession,
    readonly device: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    journal: TransactionJournal,
    /** Rereads this computer's sessions right before signing. */
    private readonly localScan?: () => Promise<DiscoveredInstance[]>,
  ) {
    this.verifier = new DeviceIdentityVerifier(chain, device, grantId);
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      signer: device,
      journal,
    });
  }
  /** Verifies authority and memberships once (reads in parallel) and quotes
   * one PTB with an import_agent call per target. */
  async quote(targets: BatchTarget[], requestId: string) {
    if (!targets.length) throw new BatchImportError("none_selected");
    if (targets.some((t) => !importable(t.instance)))
      throw new BatchImportError("not_importable");
    const [, directory] = await Promise.all([
      this.verifier.verifyOrganization(this.organizationId, "manage_hosts"),
      hostDirectory(this.chain, this.organizationId),
    ]);
    const tx = new Transaction();
    for (const t of targets) {
      const member = directory.memberships.find(
        (m) =>
          m.host_address === t.hostAddress &&
          m.coordinator_binding === t.bindingId &&
          !m.revoked &&
          BigInt(m.expires_at_ms) > directory.clockMs,
      );
      if (!member) throw new BatchImportError("host_not_member");
      this.chain.sdk.host.importAgent({
        tx,
        organizationId: this.organizationId,
        humanId: this.chain.profile.humanId,
        grantId: this.grantId,
        membershipId: member.id,
        bindingId: t.bindingId,
        instanceId: t.instance.instanceId,
        workspaceHash: fromHex(t.instance.workspaceHash),
        ...importRuntime(t.instance),
      });
    }
    const quote = await this.manager.prepare({
      requestId,
      transaction: tx,
      gasBudget: 50_000_000n + 50_000_000n * BigInt(targets.length),
    });
    this.plans.set(quote, targets);
    return quote;
  }
  /** Rechecks this computer's sessions (instant), then signs and submits. */
  async submit(quote: SelfPayFeeQuote): Promise<SelfPayTransactionOutcome> {
    const targets = this.plans.get(quote);
    if (!targets) throw new BatchImportError("quote_changed");
    if (this.localScan) {
      const now = await this.localScan();
      for (const t of targets.filter((t) => t.local)) {
        const current = now.find((i) => i.instanceId === t.instance.instanceId);
        if (!current || current.workspaceHash !== t.instance.workspaceHash)
          throw new BatchImportError("instance_gone");
      }
    }
    const outcome = await this.manager.submit(quote);
    this.plans.delete(quote);
    if (outcome.status === "confirmed")
      await awaitTransactionVisible(this.chain, outcome).catch(() => false);
    return outcome;
  }
  query(requestId: string) {
    return this.manager.query(requestId);
  }
}
