import { bcs, TypeTagSerializer } from "@mysten/sui/bcs";
import { FractalMindSDK } from "@fractalmind-labs/fractalmind-sdk";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import {
  deriveDynamicFieldID,
  isValidSuiObjectId,
  normalizeSuiAddress,
} from "@mysten/sui/utils";
import type {
  ConnectionProfile,
  Human,
  Grant,
  OrganizationSnapshot,
  OkrSnapshot,
  ReadSection,
  OrganizationSnapshot as Snapshot,
} from "./domain";
import type { OrganizationData } from "@fractalmind-labs/fractalmind-sdk";

export class ChainReadError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
const failure = (error: unknown) =>
  error instanceof ChainReadError ? error.code : "rpc_or_invalid_data";
export function normalizeProfile(value: ConnectionProfile): ConnectionProfile {
  if (!["localnet", "devnet", "testnet", "mainnet"].includes(value.network))
    throw new ChainReadError("invalid_profile");
  const url = new URL(value.rpcUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
  )
    throw new ChainReadError("invalid_profile");
  const id = (input: string) => {
    if (!isValidSuiObjectId(input)) throw new ChainReadError("invalid_profile");
    return normalizeSuiAddress(input);
  };
  return {
    network: value.network,
    rpcUrl: url.toString().replace(/\/$/, ""),
    packageId: id(value.packageId),
    originalPackageId: value.originalPackageId
      ? id(value.originalPackageId)
      : undefined,
    okrPackageId: value.okrPackageId ? id(value.okrPackageId) : undefined,
    originalOkrPackageId: value.originalOkrPackageId
      ? id(value.originalOkrPackageId)
      : undefined,
    directPackageId: value.directPackageId
      ? id(value.directPackageId)
      : undefined,
    originalDirectPackageId: value.originalDirectPackageId
      ? id(value.originalDirectPackageId)
      : undefined,
    registryId: id(value.registryId),
    humanId: id(value.humanId),
    ...(value.chainIdentifier
      ? { chainIdentifier: value.chainIdentifier }
      : {}),
  };
}
async function section<T>(read: () => Promise<T>): Promise<ReadSection<T>> {
  try {
    return { value: await read() };
  } catch (error) {
    return { value: null, failure: failure(error) };
  }
}
async function pages<T>(
  read: (
    cursor: string | null,
  ) => Promise<{ rows: T[]; cursor: string | null; hasNextPage: boolean }>,
) {
  const rows: T[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const page = await read(cursor);
    rows.push(...page.rows);
    if (!page.hasNextPage) return rows;
    if (!page.cursor || seen.has(page.cursor) || rows.length > 1000)
      throw new ChainReadError("invalid_pagination");
    seen.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);
  throw new ChainReadError("invalid_pagination");
}
export function missingIndex(
  error: unknown,
  organizationId: string,
  type: string,
) {
  return missingDynamicField(error, organizationId, type, new Uint8Array([0]));
}
export function missingDynamicField(
  error: unknown,
  parentId: string,
  type: string,
  name: Uint8Array,
) {
  const expected = deriveDynamicFieldID(
    parentId,
    TypeTagSerializer.parseFromStr(type),
    name,
  );
  return (
    typeof error === "object" &&
    error !== null &&
    "reason" in error &&
    error.reason === "notFound" &&
    "objectId" in error &&
    error.objectId === expected
  );
}

/** Read-only production SDK session. Public Human metadata is not login and
 * cannot unlock ciphertext, sign commands or act as a DeviceGrant. */
export class ChainReadSession {
  readonly sdk: FractalMindSDK;
  readonly profile: ConnectionProfile;
  private chainIdentifier?: string;
  constructor(profile: ConnectionProfile, sdk?: FractalMindSDK) {
    this.profile = normalizeProfile(profile);
    this.chainIdentifier = this.profile.chainIdentifier;
    this.sdk =
      sdk ??
      new FractalMindSDK({
        ...this.profile,
        client: new SuiGrpcClient({
          baseUrl: this.profile.rpcUrl,
          network: this.profile.network,
          timeout: 10000,
        }),
      });
  }
  async checkNetwork() {
    const { chainIdentifier } =
      await this.sdk.client.client.core.getChainIdentifier();
    if (
      !chainIdentifier ||
      (this.chainIdentifier && this.chainIdentifier !== chainIdentifier)
    )
      throw new ChainReadError("network_changed");
    this.chainIdentifier = chainIdentifier;
    return chainIdentifier;
  }
  private async clock() {
    const { object } = await this.sdk.client.client.core.getObject({
      objectId: "0x6",
      include: { content: true },
    });
    if (
      object.objectId !== normalizeSuiAddress("0x6") ||
      object.type !== `${normalizeSuiAddress("0x2")}::clock::Clock` ||
      object.owner.$kind !== "Shared" ||
      !object.content
    )
      throw new ChainReadError("invalid_clock");
    const clock = bcs
      .struct("Clock", { id: bcs.Address, timestamp_ms: bcs.u64() })
      .parse(object.content);
    if (clock.id !== object.objectId) throw new ChainReadError("invalid_clock");
    return { clockMs: BigInt(clock.timestamp_ms), loadedAtMs: Date.now() };
  }
  async human(): Promise<{
    human: Human;
    grants: ReadSection<Grant[]>;
    organizations: OrganizationData[];
    chainIdentifier: string;
    clockMs: bigint;
    loadedAtMs: number;
  }> {
    const chainIdentifier = await this.checkNetwork();
    const registryId = await this.sdk.identity.resolveRegistry(
      this.profile.registryId,
    );
    const human = await this.sdk.identity.getHuman(this.profile.humanId);
    if (
      human.id !== this.profile.humanId ||
      human.registry_id !== registryId ||
      human.network !== this.profile.network
    )
      throw new ChainReadError("invalid_provenance");
    const [organizations, grants] = await Promise.all([
      Promise.all(human.organizations.map((id) => this.organization(id))),
      section(() =>
        Promise.all(
          human.grants.map(async (id) => {
            const grant = await this.sdk.identity.getDeviceGrant(id);
            if (grant.id !== id || grant.human_id !== human.id)
              throw new ChainReadError("invalid_provenance");
            return grant;
          }),
        ),
      ),
    ]);
    const clock = await this.clock();
    await this.checkNetwork();
    return { human, grants, organizations, chainIdentifier, ...clock };
  }
  private async organization(id: string) {
    const org = await this.sdk.organization.getOrganization(id);
    if (
      org.objectId !== id ||
      org.type !==
        `${this.sdk.client.typesPackageId}::organization::Organization`
    )
      throw new ChainReadError("invalid_provenance");
    return org;
  }
  async loadOrganization(
    organizationId: string,
  ): Promise<OrganizationSnapshot> {
    await this.checkNetwork();
    const organization = await this.organization(organizationId);
    const clock = await this.clock();
    const okrs = await section(async () => {
      let records;
      try {
        records = await pages(async (cursor) => {
          const page = await this.sdk.okr.listOkrs(organizationId, cursor, 50);
          return { ...page, rows: page.okrs };
        });
      } catch (error) {
        if (this.sdk.okr.isMissingIndex(error, organizationId)) {
          await this.sdk.okr.getIndex(organizationId).then(
            () => {
              throw new ChainReadError("incomplete_directory");
            },
            (missing) => {
              if (!this.sdk.okr.isMissingIndex(missing, organizationId))
                throw missing;
            },
          );
          return [];
        }
        throw error;
      }
      return Promise.all(
        records.map(async (okr) => {
          const [budget, executions, observations] = await Promise.all([
            section(async () =>
              okr.managed_agent
                ? this.sdk.okr.getBudget(okr.id)
                : { asset: "", spent: 0n, reserved: 0n },
            ),
            section(() =>
              pages(async (cursor) => {
                const page = await this.sdk.okr.listExecutions(
                  okr.id,
                  cursor,
                  50,
                );
                return { ...page, rows: page.executions };
              }),
            ),
            section(() =>
              pages(async (cursor) => {
                const page = await this.sdk.okr.listObservations(
                  okr.id,
                  cursor,
                  50,
                );
                return { ...page, rows: page.observations };
              }),
            ),
          ]);
          const current = await this.sdk.okr.getOkr(okr.id);
          if (
            current.version !== okr.version ||
            current.agreement_version !== okr.agreement_version ||
            current.next_kr !== okr.next_kr
          )
            throw new ChainReadError("snapshot_changed");
          return {
            okr,
            budget,
            executions,
            observations,
          } satisfies OkrSnapshot;
        }),
      );
    });
    const index = await section(async () => {
      try {
        return await this.sdk.host.getIndex(organizationId);
      } catch (error) {
        if (
          missingIndex(
            error,
            organizationId,
            `${this.sdk.client.typesPackageId}::host::HostIndexBinding`,
          )
        )
          return null;
        throw error;
      }
    });
    const scoped = <T extends { id: string; org_id: string }>(
      value: T,
      id: string,
    ) => {
      if (value.id !== id || value.org_id !== organizationId)
        throw new ChainReadError("invalid_provenance");
      return value;
    };
    const [memberships, agents, bindings] = await Promise.all([
      index.value
        ? section(() =>
            Promise.all(
              index.value!.memberships.map(async (id) =>
                scoped(await this.sdk.host.getMembership(id), id),
              ),
            ),
          )
        : Promise.resolve({
            value: index.failure ? null : [],
            failure: index.failure,
          } as Snapshot["memberships"]),
      index.value
        ? section(async () =>
            (
              await pages(async (cursor) => {
                const page = await this.sdk.host.listManagedAgents(
                  organizationId,
                  cursor,
                  50,
                );
                return { ...page, rows: page.agents };
              })
            ).map((agent) => scoped(agent, agent.id)),
          )
        : Promise.resolve({
            value: index.failure ? null : [],
            failure: index.failure,
          } as Snapshot["agents"]),
      index.value
        ? section(() =>
            Promise.all(
              index.value!.bindings.map(async (id) =>
                scoped(await this.sdk.host.getCoordinatorBinding(id), id),
              ),
            ),
          )
        : Promise.resolve({
            value: index.failure ? null : [],
            failure: index.failure,
          } as Snapshot["bindings"]),
    ]);
    const hosts = await section(async () => {
      if (!memberships.value)
        throw new ChainReadError("membership_not_readable");
      const addresses = [
        ...new Set(memberships.value.map((member) => member.host_address)),
      ];
      return Promise.all(
        addresses.map(async (address) => ({
          address,
          history: memberships.value!.filter(
            (member) => member.host_address === address,
          ),
          current: await section(async () => {
            if (!index.value)
              throw new ChainReadError("membership_not_readable");
            const name = {
              type: "address",
              bcs: bcs.Address.serialize(address).toBytes(),
            };
            const field = await this.sdk.client.client.core
              .getDynamicField({
                parentId: index.value.active_hosts.id,
                name,
              })
              .catch((error) => {
                // Revocation removes this exact pointer. It is a known absence,
                // distinct from an unreadable directory or a missing child object.
                if (
                  missingDynamicField(
                    error,
                    index.value!.active_hosts.id,
                    name.type,
                    name.bcs,
                  )
                )
                  return null;
                throw error;
              });
            if (!field) return null;
            if (
              field.dynamicField.value.type !==
              `${normalizeSuiAddress("0x2")}::object::ID`
            )
              throw new ChainReadError("invalid_provenance");
            const id = bcs.Address.parse(field.dynamicField.value.bcs);
            const member = scoped(await this.sdk.host.getMembership(id), id);
            if (member.host_address !== address)
              throw new ChainReadError("invalid_provenance");
            return member;
          }),
        })),
      );
    });
    await this.checkNetwork();
    return {
      organization,
      ...clock,
      okrs,
      memberships,
      agents,
      bindings,
      hosts,
    };
  }
}
