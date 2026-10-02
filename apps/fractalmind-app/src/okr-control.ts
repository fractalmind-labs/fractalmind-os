import { bcs } from "@mysten/sui/bcs";
import {
  AuthorityBindingBcs,
  SelfPayTransactionManager,
  bytesToHex,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
  type TransactionJournal,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { NativeDeviceSigner } from "./native-device";
import { hostDirectory } from "./host-admission";
import { managedInstance } from "./agent-import";
import { canonical } from "./handover-plan";
import { awaitTransactionVisible } from "./transaction-visibility";

export class OkrControlError extends Error {
  constructor(
    readonly code:
      | "invalid_source"
      | "state_changed"
      | "invalid_quote"
      | "sync_pending"
      | "unsettled_execution",
  ) {
    super(code);
  }
}
const id = /^0x[0-9a-f]{64}$/;
/** Single-use capability for one explicitly reviewed agreement/KR/device.
 * Opening, quotation and recovery do not prepare or dispatch an execution. */
export class OkrControl {
  readonly requestId: string;
  private readonly verifier: DeviceIdentityVerifier;
  private readonly manager: SelfPayTransactionManager;
  private readonly quotes = new WeakMap<SelfPayFeeQuote, () => Promise<void>>();
  private guard?: () => Promise<void>;
  private flight?: {
    quote: SelfPayFeeQuote;
    result: Promise<SelfPayTransactionOutcome>;
  };
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly okrId: string,
    readonly agreementVersion: string,
    readonly krIndex: string,
    journal: TransactionJournal,
    private readonly assertActive: () => void = () => {},
    private readonly expected?: { okrVersion: string; policyPin: string },
  ) {
    if (
      ![grantId, organizationId, okrId].every((v) => id.test(v)) ||
      !/^[1-9][0-9]*$/.test(agreementVersion) ||
      !/^[0-2]$/.test(krIndex)
    )
      throw new OkrControlError("invalid_source");
    this.requestId = `okr-control:${okrId}:${agreementVersion}:${krIndex}`;
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      journal,
      assertBeforeBroadcast: assertActive,
      signer: {
        getPublicKey: () => signer.getPublicKey(),
        signTransaction: async (bytes) => {
          const guard = this.guard;
          if (!guard) throw new OkrControlError("invalid_quote");
          await guard();
          const signed = await signer.signTransaction(bytes);
          await guard();
          return signed;
        },
      },
    });
  }
  async query() {
    await this.chain.checkNetwork();
    return this.manager.query(this.requestId);
  }
  private async source() {
    this.assertActive();
    const authority = await this.verifier.verifyOrganization(
      this.organizationId,
      "approve",
    );
    if (
      !(["read", "operate", "approve"] as const).every((a) =>
        authority.actions.includes(a),
      )
    )
      throw new OkrControlError("invalid_source");
    const okr = await this.chain.sdk.okr.getOkr(this.okrId);
    if (
      okr.org_id !== this.organizationId ||
      okr.owner_human !== authority.humanId ||
      okr.state !== 1 ||
      (this.expected && okr.version !== this.expected.okrVersion) ||
      okr.agreement_version !== this.agreementVersion ||
      okr.next_kr !== this.krIndex ||
      !okr.managed_agent ||
      !okr.membership_id ||
      BigInt(okr.expires_at_ms) <= authority.clockMs ||
      BigInt(okr.expires_at_ms) <= BigInt(Date.now())
    )
      throw new OkrControlError("state_changed");
    const metric = okr.metrics[Number(okr.next_kr)];
    if (metric?.current !== null && metric?.run_id && metric?.evidence_id)
      throw new OkrControlError("state_changed");
    const coverage = await this.chain.sdk.nodeExecution.readAgentExecutions(
      this.organizationId,
      okr.managed_agent,
    );
    if (coverage.unsettledControl)
      throw new OkrControlError("unsettled_execution");
    const managed = coverage.managed;
    if (
      managed.revoked ||
      !managed.control_confirmed ||
      managed.runtime !== "bounded-process-v1" ||
      managed.version !== okr.managed_version ||
      managed.membership_id !== okr.membership_id ||
      canonical(managed.workspace_hash) !== canonical(okr.workspace_hash)
    )
      throw new OkrControlError("invalid_source");
    const hosts = await hostDirectory(this.chain, this.organizationId);
    const member = hosts.memberships.find(
      (m) =>
        m.id === okr.membership_id &&
        m.version === okr.membership_version &&
        !m.revoked &&
        m.host_address === managed.host_address &&
        BigInt(m.expires_at_ms) > hosts.clockMs,
    );
    const binding = hosts.bindings.find(
      (b) => b.id === member?.coordinator_binding && !b.revoked,
    );
    if (!member || !binding || !hosts.activeHostsTableId)
      throw new OkrControlError("invalid_source");
    const { dynamicField } =
      await this.chain.sdk.client.client.core.getDynamicField({
        parentId: hosts.activeHostsTableId,
        name: {
          type: "address",
          bcs: bcs.Address.serialize(member.host_address).toBytes(),
        },
      });
    if (
      !["0x2::object::ID", `0x${"2".padStart(64, "0")}::object::ID`].includes(
        dynamicField.value.type,
      ) ||
      bcs.Address.parse(dynamicField.value.bcs) !== member.id ||
      canonical(
        await managedInstance(
          this.chain,
          this.organizationId,
          managed.host_address,
          managed.instance_id,
        ),
      ) !== canonical(managed)
    )
      throw new OkrControlError("state_changed");
    const [policy, budget] = await Promise.all([
      this.chain.sdk.handover.getPolicy(okr.id),
      this.chain.sdk.okr.getBudget(okr.id),
    ]);
    if (
      policy.agreement_version !== okr.agreement_version ||
      (this.expected && canonical(policy) !== this.expected.policyPin) ||
      policy.managed_version !== managed.version ||
      BigInt(policy.max_calls) < 1n ||
      BigInt(policy.max_calls) > BigInt(okr.budget_limit) ||
      budget.spent + budget.reserved >= BigInt(okr.budget_limit)
    )
      throw new OkrControlError("state_changed");
    this.assertActive();
    return {
      authority,
      okr,
      managed,
      member,
      binding,
      policy,
      budget,
      pin: canonical([
        authority.authorityPin,
        okr,
        coverage.revision,
        managed,
        member,
        binding,
        policy,
        budget,
        hosts.activeHostsTableId,
        hosts.instancesTableId,
      ]),
    };
  }
  async prepare() {
    const prior = await this.query();
    if (prior) return prior;
    const before = await this.source();
    const guard = async () => {
      if ((await this.source()).pin !== before.pin)
        throw new OkrControlError("state_changed");
    };
    const transaction = this.chain.sdk.okr.issueCapability({
      okrId: this.okrId,
      organizationId: this.organizationId,
      humanId: this.chain.profile.humanId,
      grantId: this.grantId,
      expectedVersion: before.okr.version,
      membershipId: before.member.id,
      bindingId: before.binding.id,
      managedAgentId: before.managed.id,
      maxUses: 1n,
    });
    const quote = await this.manager.prepare({
      requestId: this.requestId,
      transaction,
      gasBudget: 200000000n,
    });
    await guard();
    this.quotes.set(quote, guard);
    return quote;
  }
  submit(quote: SelfPayFeeQuote) {
    if (!this.quotes.has(quote))
      return Promise.reject(new OkrControlError("invalid_quote"));
    if (this.flight)
      return this.flight.quote === quote
        ? this.flight.result
        : Promise.reject(new OkrControlError("invalid_quote"));
    const result = this.submitOnce(quote).finally(() => {
      this.flight = undefined;
    });
    this.flight = { quote, result };
    return result;
  }
  private async submitOnce(quote: SelfPayFeeQuote) {
    const prior = await this.query();
    if (prior) return prior;
    const guard = this.quotes.get(quote)!;
    await guard();
    this.guard = guard;
    try {
      return await this.manager.submit(quote);
    } finally {
      this.guard = undefined;
    }
  }
  /** A cached ID is only a locator. Current chain binding is always checked;
   * it never establishes success of an unknown original transaction. */
  async use(capabilityId: string) {
    if (!id.test(capabilityId)) throw new OkrControlError("invalid_source");
    const source = await this.source();
    const core = this.chain.sdk.client.client.core,
      types = this.chain.sdk.client.typesPackageId;
    const { object } = await core.getObject({ objectId: capabilityId });
    if (
      !id.test(capabilityId) ||
      object.objectId !== capabilityId ||
      object.type !== `${types}::remote_authority::RemoteCapability` ||
      object.owner.$kind !== "Shared"
    )
      throw new OkrControlError("invalid_source");
    const [cap, contract, { dynamicField }] = await Promise.all([
      this.chain.sdk.remoteAuthority.getCapability(capabilityId),
      this.chain.sdk.okr.getCapabilityContract(capabilityId),
      core.getDynamicField({
        parentId: capabilityId,
        name: {
          type: `${types}::host::AuthorityBindingKey`,
          bcs: new Uint8Array([0]),
        },
      }),
    ]);
    if (dynamicField.value.type !== `${types}::host::AuthorityBinding`)
      throw new OkrControlError("invalid_source");
    const binding = AuthorityBindingBcs.parse(dynamicField.value.bcs);
    if (
      cap.revoked ||
      cap.parentId ||
      cap.objectId !== capabilityId ||
      cap.type !== object.type ||
      cap.orgId !== this.organizationId ||
      cap.delegate !== this.signer.device.address ||
      cap.nodeId !== source.member.host_address ||
      cap.agentId !== source.managed.instance_id ||
      cap.scope !== "control" ||
      canonical(cap.actions) !== '["assign"]' ||
      cap.maxUses !== 1n ||
      cap.usesClaimed !== 0n ||
      cap.usesDelegated !== 0n ||
      cap.budgetClaimed !== 0n ||
      cap.budgetDelegated !== 0n ||
      cap.budgetAsset !== source.okr.budget_asset ||
      cap.maxBudget !== BigInt(source.policy.max_calls) ||
      cap.expiresAtMs <= source.authority.clockMs ||
      cap.expiresAtMs !== BigInt(source.okr.expires_at_ms) ||
      contract.contract_id !== this.okrId ||
      contract.agreement_version !== this.agreementVersion ||
      bytesToHex(Uint8Array.from(contract.boundary_hash)) !==
        bytesToHex(Uint8Array.from(source.okr.boundary_hash)) ||
      binding.human_id !== source.authority.humanId ||
      binding.device_grant !== this.grantId ||
      binding.device_grant_version !== source.authority.grantVersion ||
      binding.human_generation !== source.authority.generation ||
      binding.membership_id !== source.member.id ||
      binding.membership_version !== source.member.version ||
      binding.managed_agent !== source.managed.id ||
      binding.managed_agent_version !== source.managed.version ||
      binding.required_action !== 2
    )
      throw new OkrControlError("invalid_source");
    if ((await this.source()).pin !== source.pin)
      throw new OkrControlError("state_changed");
    return { capabilityId, source };
  }
  async confirmed(result: SelfPayTransactionOutcome) {
    if (
      result.status !== "confirmed" ||
      result.requestId !== this.requestId ||
      result.transaction?.digest !== result.digest
    )
      throw new OkrControlError("invalid_source");
    const created = result.transaction.effects.changedObjects.filter(
      (o) =>
        o.idOperation === "Created" &&
        o.outputState === "ObjectWrite" &&
        result.transaction?.objectTypes?.[o.objectId] ===
          `${this.chain.sdk.client.typesPackageId}::remote_authority::RemoteCapability`,
    );
    if (created.length !== 1) throw new OkrControlError("invalid_source");
    if (!(await awaitTransactionVisible(this.chain, result)))
      throw new OkrControlError("sync_pending");
    const { object } = await this.chain.sdk.client.client.core.getObject({
      objectId: created[0].objectId,
      include: { previousTransaction: true },
    });
    if (object.previousTransaction !== result.digest)
      throw new OkrControlError("invalid_source");
    await this.use(created[0].objectId);
    return created[0].objectId;
  }
}
