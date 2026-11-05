// Signed localnet operations for Agent operators.  The page never accepts a
// caller-provided scope or a broad action vector: Move rechecks this too, but
// keeping the UI narrow makes a misleading confirmation impossible.
import { coinWithBalance, Transaction } from "@mysten/sui/transactions";
import {
  IndexedDbTransactionJournal,
  SelfPayTransactionManager,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { NativeDeviceSigner, type NativeInvoke } from "./native-device";
import { asDeviceActions, operatorExpiryAt } from "./agent-operators";
import { isAgentPairing } from "./agent-operator-chain";
import { organizationKeyVersion, wrapOrgKeysForAgent } from "./pairing";

const id = /^0x[0-9a-f]{64}$/;
const gasBudget = 200_000_000n;
export type AgentOperatorOperation =
  | { kind: "approve"; requestId: string; grantId: string; operate: boolean; days: number; label: string }
  | { kind: "reject"; requestId: string; grantId: string }
  | { kind: "change"; targetGrantId: string; grantId: string; operate: boolean; days: number }
  | { kind: "revoke"; targetGrantId: string; grantId: string }
  | { kind: "fund"; targetGrantId: string; grantId: string; mist: bigint };

type Plan = { operation: AgentOperatorOperation; requestId: string; pin: string; wrappedKeys?: Uint8Array };

export class AgentOperatorFlowError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_source" | "state_changed" | "unsupported_network" | "invalid_quote") {
    super(code);
  }
}
function fail(code: AgentOperatorFlowError["code"]): never {
  throw new AgentOperatorFlowError(code);
}
function localnet(chain: ChainReadSession) {
  if (chain.profile.network !== "localnet") fail("unsupported_network");
}
function text(value: string) {
  const normalized = value.trim();
  if (!normalized || new TextEncoder().encode(normalized).length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) fail("invalid_input");
  return normalized;
}
function operationId(operation: AgentOperatorOperation) {
  const target = "requestId" in operation ? operation.requestId : operation.targetGrantId;
  return `agent-operator:${operation.kind}:${target}`;
}

export class AgentOperatorFlow {
  readonly manager: SelfPayTransactionManager;
  private plans = new WeakMap<SelfPayFeeQuote, Plan>();
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly invoke: NativeInvoke,
    journal: TransactionJournal = new IndexedDbTransactionJournal(),
  ) {
    localnet(chain);
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      signer,
      journal,
    });
  }

  private async authority(grantId: string, organizationId: string) {
    if (!id.test(grantId) || !id.test(organizationId)) fail("invalid_input");
    return new DeviceIdentityVerifier(this.chain, this.signer, grantId).verifyOrganization(organizationId, "approve");
  }

  private async source(operation: AgentOperatorOperation) {
    localnet(this.chain);
    const human = await this.chain.human();
    const grants = human.grants.value;
    if (!grants) fail("invalid_source");
    if (operation.kind === "approve" || operation.kind === "reject") {
      if (!id.test(operation.requestId)) fail("invalid_input");
      const request = await this.chain.sdk.identity.getDevicePairing(operation.requestId);
      if (
        request.id !== operation.requestId ||
        request.human_id !== human.human.id ||
        request.status !== 0 ||
        request.generation !== human.human.generation ||
        BigInt(request.expires_at_ms) <= human.clockMs ||
        !(await isAgentPairing(this.chain, operation.requestId))
      ) fail("state_changed");
      const proof = await this.authority(operation.grantId, request.organization_id);
      if (operation.kind === "approve") {
        const label = text(operation.label);
        operatorExpiryAt(proof.clockMs, operation.days);
        return {
          human,
          proof,
          organizationId: request.organization_id,
          request,
          label,
          pin: JSON.stringify([human.chainIdentifier, human.human.generation, request, proof.authorityPin]),
        };
      }
      return {
        human,
        proof,
        organizationId: request.organization_id,
        request,
        pin: JSON.stringify([human.chainIdentifier, human.human.generation, request, proof.authorityPin]),
      };
    }
    if (!id.test(operation.targetGrantId)) fail("invalid_input");
    const target = grants.find((grant) => grant.id === operation.targetGrantId);
    if (
      !target || target.human_id !== human.human.id || target.org_scope === null || target.revoked ||
      target.generation !== human.human.generation || !(await this.agentOperator(target.id))
    ) fail("state_changed");
    const proof = await this.authority(operation.grantId, target.org_scope);
    if (operation.kind === "change") operatorExpiryAt(proof.clockMs, operation.days);
    if (operation.kind === "fund" && (operation.mist <= 0n || operation.mist > 100_000_000_000n)) fail("invalid_input");
    return {
      human,
      proof,
      organizationId: target.org_scope,
      target,
      pin: JSON.stringify([human.chainIdentifier, human.human.generation, target, proof.authorityPin]),
    };
  }

  private async agentOperator(grantId: string) {
    try {
      await this.chain.sdk.identity.getAgentOperator(grantId);
      return true;
    } catch (error) {
      // getAgentOperator's only benign failure is the absent dynamic field. A
      // verifier later sees a missing marker as a changed source; do not turn
      // RPC/corruption errors into a permission decision.
      if (error && typeof error === "object" && "reason" in error && (error as { reason?: unknown }).reason === "notFound") return false;
      throw error;
    }
  }

  async query(operation: AgentOperatorOperation) {
    return this.manager.query(operationId(operation));
  }

  async prepare(operation: AgentOperatorOperation): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    localnet(this.chain);
    const requestId = operationId(operation);
    const original = await this.manager.query(requestId);
    if (original) return original;
    const before = await this.source(operation);
    let transaction: Transaction;
    let wrappedKeys: Uint8Array | undefined;
    if (operation.kind === "approve") {
      const label = before.label;
      const request = before.request;
      const encryptedKeys = before.proof.encryptedKeys;
      const network = this.chain.profile.network;
      if (
        typeof label !== "string" ||
        !request ||
        typeof encryptedKeys !== "string" ||
        network !== "localnet"
      )
        fail("invalid_source");
      // The native overload keeps the owner keyring in the vault; its pure
      // counterpart is used by the localnet CLI acceptance.
      const keyVersion = await organizationKeyVersion(
        this.chain,
        before.organizationId,
      );
      wrappedKeys = await wrapOrgKeysForAgent({
        invoke: this.invoke,
        profile: this.signer.device.profile,
        network,
        organizationId: before.organizationId,
        keyVersion,
        organizationCount: before.human.human.organizations.length,
        encryptedKeys,
        recipientAddress: request.device,
        signingPublicKey: Uint8Array.from(request.signing_public_key),
        encryptionPublicKey: Uint8Array.from(request.encryption_public_key),
      });
      transaction = this.chain.sdk.identity.approveAgentOperator({
        identityRegistryId: await this.chain.sdk.identity.resolveRegistry(this.chain.profile.registryId),
        humanId: before.human.human.id,
        grantId: operation.grantId,
        requestId: operation.requestId,
        organizationId: before.organizationId,
        actions: asDeviceActions(operation.operate),
        expiresAtMs: operatorExpiryAt(before.proof.clockMs, operation.days),
        label,
        encryptedKeys: wrappedKeys,
      });
    } else if (operation.kind === "reject") {
      transaction = this.chain.sdk.identity.rejectDevicePairing({
        humanId: before.human.human.id, grantId: operation.grantId,
        organizationId: before.organizationId, requestId: operation.requestId,
      });
    } else if (operation.kind === "change") {
      transaction = this.chain.sdk.identity.changeDevicePermissions({
        humanId: before.human.human.id, grantId: operation.grantId,
        targetGrantId: operation.targetGrantId, organizationId: before.organizationId,
        actions: asDeviceActions(operation.operate),
        expiresAtMs: operatorExpiryAt(before.proof.clockMs, operation.days),
      });
    } else if (operation.kind === "revoke") {
      transaction = this.chain.sdk.identity.revokeDevice({
        humanId: before.human.human.id, grantId: operation.grantId, targetGrantId: operation.targetGrantId,
      });
    } else {
      const target = before.target;
      if (!target) fail("invalid_source");
      transaction = new Transaction();
      transaction.transferObjects([coinWithBalance({ balance: operation.mist })], target.device);
    }
    const after = await this.source(operation);
    if (before.pin !== after.pin) fail("state_changed");
    const quote = await this.manager.prepare({
      requestId,
      transaction,
      gasBudget,
      maxSuiSpend: operation.kind === "fund" ? operation.mist : 0n,
    });
    this.plans.set(quote, { operation: structuredClone(operation), requestId, pin: before.pin, wrappedKeys });
    return quote;
  }

  async submit(quote: SelfPayFeeQuote) {
    localnet(this.chain);
    const plan = this.plans.get(quote);
    if (!plan || plan.requestId !== quote.requestId) fail("invalid_quote");
    const original = await this.manager.query(plan.requestId);
    if (original) return original;
    if ((await this.source(plan.operation)).pin !== plan.pin) fail("state_changed");
    return this.manager.submit(quote);
  }

  /** Locate the exact newly-created Agent grant from an approval receipt.  The
   * next, optional funding transaction is never aimed at an address copied
   * from the form. */
  async approvedGrantId(outcome: SelfPayTransactionOutcome) {
    if (outcome.status !== "confirmed") fail("invalid_source");
    const grantType = await this.chain.sdk.client.coreType("identity", "DeviceGrant");
    const ids = Object.entries(outcome.transaction?.objectTypes ?? {})
      .filter(([, type]) => type === grantType)
      .map(([objectId]) => objectId);
    if (ids.length !== 1 || !(await this.agentOperator(ids[0]))) fail("invalid_source");
    return ids[0];
  }
}
