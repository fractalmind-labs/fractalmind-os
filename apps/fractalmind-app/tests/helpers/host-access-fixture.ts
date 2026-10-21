/** No network or native signing: shared by interaction tests and the UI preview. */
import {
  CoordinatorBindingBcs,
  HostIndexBcs,
  HostInviteBcs,
  TransactionPreflightError,
  type SelfPayFeeQuote,
  type SelfPayTransactionOutcome,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "../../src/chain";
import { OrganizationBcs } from "../../src/device-identity";
import { HostAdmission, type HostDirectory } from "../../src/host-admission";
import { NativeDeviceSigner } from "../../src/native-device";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";

const id = (n: string) => `0x${n.padStart(64, "0")}`;
export function hostAccessFixture() {
  const profile = {
    network: "localnet" as const,
    rpcUrl: "http://127.0.0.1:29000",
    packageId: id("1"),
    registryId: id("2"),
    humanId: id("3"),
    chainIdentifier: "Test1",
  };
  const organizationId = id("4"),
    grantId = id("5"),
    bindingId = id("6"),
    inviteId = id("7");
  const key = Ed25519Keypair.generate().getPublicKey();
  const table = { id: id("8"), size: "0" };
  const org = {
    id: organizationId,
    name: "Test organization",
    description: "",
    admin: profile.humanId,
    is_active: true,
    agents: table,
    agent_count: "0",
    tasks: table,
    task_count: "0",
    parent_org: null,
    child_orgs: table,
    child_org_count: "0",
    depth: "0",
    created_at: "1",
  };
  const binding = {
    id: bindingId,
    org_id: organizationId,
    coordinator_address: key.toSuiAddress(),
    public_key: Array.from(key.toRawBytes()),
    endpoint: "https://coordinator.example.com",
    version: "1",
    revoked: false,
  };
  const invite = {
    id: inviteId,
    org_id: organizationId,
    coordinator_binding: bindingId,
    binding_version: "1",
    issuer_human: profile.humanId,
    issuer_device: key.toSuiAddress(),
    issuer_grant: grantId,
    issuer_grant_version: "1",
    issuer_generation: "1",
    proof_public_key: Array(32).fill(7),
    template_version: "1",
    expires_at_ms: String(Date.now() + 3600000),
    membership_ttl_ms: "7776000000",
    capability_ttl_ms: "7776000000",
    max_uses: 1,
    uses: 0,
    revoked: false,
  };
  const index = {
    bindings: [bindingId],
    invitations: [inviteId],
    memberships: [],
    active_hosts: table,
    instances: table,
  };
  const directory: HostDirectory = {
    chainIdentifier: "Test1",
    bindings: [binding],
    invitations: [invite],
    memberships: [],
    clockMs: BigInt(Date.now()),
    loadedAtMs: Date.now(),
    activeHostsTableId: table.id,
    instancesTableId: table.id,
  };
  const quote = {
    requestId: "host:fixture",
    sender: key.toSuiAddress(),
    estimatedGas: "3000000",
    simulatedSuiSpend: "50000000",
    balance: "1000000000",
    gasBudget: "200000000",
    expiresAtMs: Date.now() + 60000,
  } as SelfPayFeeQuote;
  const outcome = {
    status: "confirmed",
    requestId: quote.requestId,
    digest: "fixture-original",
    journalSynced: true,
  } as SelfPayTransactionOutcome;
  const reads: string[] = [];
  let prepares = 0,
    submissions = 0,
    changed = 0,
    slow: Promise<void> | null = null;
  let mode: "success" | "expensive" | "error" | "unknown" = "success";
  const restores: (() => void)[] = [];
  function patch(target: any, name: string, value: any) {
    const original = target[name];
    target[name] = value;
    restores.push(() => {
      target[name] = original;
    });
  }
  patch(ChainReadSession.prototype, "checkNetwork", async () => "Test1");
  patch(
    ChainReadSession.prototype,
    "identity",
    async function (this: ChainReadSession) {
      Object.defineProperty(this.sdk.client.client, "core", {
        configurable: true,
        value: {
          getObject: async ({ objectId }: { objectId: string }) => {
            reads.push(objectId);
            const data =
              objectId === organizationId
                ? [
                    "organization",
                    "Organization",
                    OrganizationBcs.serialize(org).toBytes(),
                  ]
                : objectId === bindingId
                  ? [
                      "host",
                      "CoordinatorBinding",
                      CoordinatorBindingBcs.serialize(binding).toBytes(),
                    ]
                  : [
                      "host",
                      "HostInvite",
                      HostInviteBcs.serialize(invite).toBytes(),
                    ];
            return {
              object: {
                objectId,
                type: `${profile.packageId}::${data[0]}::${data[1]}`,
                content: data[2],
                version: "1",
                owner: { $kind: "Shared" },
              },
            };
          },
          getDynamicField: async () => ({
            dynamicField: {
              value: {
                type: `${profile.packageId}::host::HostIndex`,
                bcs: HostIndexBcs.serialize(index).toBytes(),
              },
            },
          }),
        },
      });
      this.sdk.client.coreType = async (module, kind) =>
        `${profile.packageId}::${module}::${kind}`;
      return {
        human: { organizations: [organizationId] },
        clockMs: directory.clockMs,
        loadedAtMs: directory.loadedAtMs,
      };
    },
  );
  patch(ChainReadSession.prototype, "human", async () => ({
    human: { generation: "1" },
    grants: {
      value: [
        {
          id: grantId,
          device: key.toSuiAddress(),
          revoked: false,
          generation: "1",
          actions: [1, 4],
          expires_at_ms: String(Date.now() + 3600000),
          org_scope: organizationId,
        },
      ],
    },
    clockMs: BigInt(Date.now()),
  }));
  patch(NativeDeviceSigner, "load", async () => ({
    device: { address: key.toSuiAddress() },
  }));
  patch(HostAdmission.prototype, "prepare", async () => {
    prepares++;
    if (slow) await slow;
    if (mode === "error")
      throw new TransactionPreflightError("rpc_unavailable", "Fixture offline");
    if (mode === "unknown") return { ...outcome, status: "unknown" };
    return {
      ...quote,
      estimatedGas: mode === "expensive" ? "11000000" : quote.estimatedGas,
    };
  });
  patch(HostAdmission.prototype, "submit", async () => {
    submissions++;
    return outcome;
  });
  patch(HostAdmission.prototype, "createdInvite", async () => ({
    directory,
    invite,
    code: "FHI1:fixture-secret-for-ui-only",
  }));
  return {
    profile,
    organizationId,
    inviteId,
    reads,
    counts: () => ({ prepares, submissions, changed }),
    onChanged: () => changed++,
    mode: (value: typeof mode) => {
      mode = value;
    },
    pause: () => {
      let resume!: () => void;
      slow = new Promise<void>((resolve) => {
        resume = resolve;
      });
      return resume;
    },
    restore: () => restores.reverse().forEach((fn) => fn()),
  };
}
