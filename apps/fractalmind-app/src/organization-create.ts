import { DEVICE_ACTIONS, SelfPayTransactionManager, type SelfPayFeeQuote, type SelfPayTransactionOutcome, type TransactionJournal } from "@fractalmind-labs/fractalmind-sdk";
import type { Signer } from "@mysten/sui/cryptography";
import type { OrganizationData } from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import type { Grant } from "./domain";

/** The protocol's `new_organization` allowance is in bytes; the product
 * contract is deliberately narrower: visible Unicode code points. */
export const ORGANIZATION_NAME_MAX = 64;
export const ORGANIZATION_DESCRIPTION_MAX = 280;
export const ORGANIZATION_GAS_BUDGET = 200_000_000n;

export type OrganizationCreateErrorCode =
  | "not_root_device"
  | "invalid_name"
  | "invalid_description"
  | "invalid_request_id"
  | "human_changed"
  | "organization_not_visible";

export class OrganizationCreateError extends Error {
  constructor(readonly code: OrganizationCreateErrorCode) {
    super(code);
  }
}

export type OrganizationInput = { name: string; description: string };
export type OrganizationValidation =
  | { ok: true; name: string; description: string; duplicate: boolean }
  | { ok: false; code: "invalid_name" | "invalid_description" };

type GrantFacts = Pick<
  Grant,
  "id" | "device" | "org_scope" | "actions" | "revoked" | "generation" | "expires_at_ms"
>;

/** Mirrors identity::assert_root: this is presentation guidance only. The
 * transaction path re-reads these facts and the Move contract remains final. */
export function isRootGrant(
  grant: GrantFacts,
  generation: Grant["generation"],
  clockMs: bigint,
) {
  return (
    grant.org_scope === null &&
    grant.actions.includes(DEVICE_ACTIONS.approve) &&
    !grant.revoked &&
    String(grant.generation) === String(generation) &&
    BigInt(grant.expires_at_ms) > clockMs
  );
}

export function rootGrants(
  grants: readonly GrantFacts[] | null | undefined,
  generation: Grant["generation"],
  clockMs: bigint,
) {
  return (grants ?? []).filter((grant) => isRootGrant(grant, generation, clockMs));
}

export function rootGrantForDevice(
  grants: readonly GrantFacts[] | null | undefined,
  device: string | null | undefined,
  generation: Grant["generation"],
  clockMs: bigint,
) {
  return rootGrants(grants, generation, clockMs).find((grant) => grant.device === device) ?? null;
}

export function validateOrganization(
  input: OrganizationInput,
  organizations: readonly Pick<OrganizationData, "name">[],
): OrganizationValidation {
  const name = String(input.name ?? "").trim();
  const description = String(input.description ?? "").trim();
  if (!name || Array.from(name).length > ORGANIZATION_NAME_MAX)
    return { ok: false, code: "invalid_name" };
  if (Array.from(description).length > ORGANIZATION_DESCRIPTION_MAX)
    return { ok: false, code: "invalid_description" };
  return {
    ok: true,
    name,
    description,
    duplicate: organizations.some((organization) => organization.name.trim() === name),
  };
}

export type OrganizationKind = "suborganization" | "personal" | "organization";

export function organizationKindText(kind: OrganizationKind): [string, string] {
  const labels: Record<OrganizationKind, [string, string]> = {
    suborganization: ["子组织", "Sub-organization"],
    personal: ["个人组织", "Personal organization"],
    organization: ["组织", "Organization"],
  };
  return labels[kind];
}

/** The Human vector is authoritative and ordered. The first entry is the
 * onboarding-created personal organization; other depth-zero entries are
 * organizations created through this flow. */
export function organizationKind(
  organization: Pick<OrganizationData, "objectId" | "depth">,
  organizations: readonly Pick<OrganizationData, "objectId" | "depth">[],
): OrganizationKind {
  if (Number(organization.depth) > 0) return "suborganization";
  return organizations[0]?.objectId === organization.objectId
    ? "personal"
    : "organization";
}

/** A confirmed transaction is reconciled from the Human directory, not from a
 * guessed object change. One and only one new directory entry identifies it. */
export function addedOrganizationId(
  beforeOrganizationIds: readonly string[],
  organizations: readonly Pick<OrganizationData, "objectId">[],
) {
  const previous = new Set(beforeOrganizationIds);
  const added = organizations
    .map((organization) => organization.objectId)
    .filter((organizationId) => !previous.has(organizationId));
  return added.length === 1 ? added[0] : null;
}

/** Devices with a currently-valid, organization-scoped grant for some other
 * organization cannot use the newly-created one until explicitly authorized. */
export function restrictedDevices(
  grants: readonly GrantFacts[] | null | undefined,
  generation: Grant["generation"],
  clockMs: bigint,
  organizationId: string,
) {
  const seen = new Set<string>();
  return (grants ?? []).filter((grant) => {
    const restricted =
      grant.org_scope !== null &&
      grant.org_scope !== organizationId &&
      !grant.revoked &&
      String(grant.generation) === String(generation) &&
      BigInt(grant.expires_at_ms) > clockMs;
    if (!restricted || seen.has(grant.device)) return false;
    seen.add(grant.device);
    return true;
  });
}

/** The stable request is intentionally public metadata only. The form body,
 * key material and transaction bytes never leave the signer or journal. */
export function organizationRequestId(profile: string, humanId: string, nonce: string) {
  const requestId = `org-new:${profile}:${humanId}:${nonce}`;
  if (!/^[A-Za-z0-9._:/@+\-]{1,128}$/.test(requestId))
    throw new OrganizationCreateError("invalid_request_id");
  return requestId;
}

export class OrganizationCreation {
  readonly manager: SelfPayTransactionManager;
  constructor(
    readonly chain: ChainReadSession,
    signer: Pick<Signer, "getPublicKey" | "signTransaction">,
    journal: TransactionJournal,
  ) {
    this.manager = new SelfPayTransactionManager({
      client: chain.sdk.client.client,
      network: chain.profile.network,
      signer,
      journal,
    });
  }

  async prepare(input: {
    requestId: string;
    humanId: string;
    device: string;
    name: string;
    description: string;
  }): Promise<SelfPayFeeQuote | SelfPayTransactionOutcome> {
    const identity = await this.chain.human();
    if (identity.human.id !== input.humanId)
      throw new OrganizationCreateError("human_changed");
    const valid = validateOrganization(input, identity.organizations);
    if (!valid.ok) throw new OrganizationCreateError(valid.code);
    const grant = rootGrantForDevice(
      identity.grants.value,
      input.device,
      identity.human.generation,
      identity.clockMs,
    );
    if (!grant) throw new OrganizationCreateError("not_root_device");
    const original = await this.manager.query(input.requestId);
    if (original) return original;
    return this.manager.prepare({
      requestId: input.requestId,
      gasBudget: ORGANIZATION_GAS_BUDGET,
      transaction: this.chain.sdk.identity.createOrganization({
        humanId: identity.human.id,
        grantId: grant.id,
        name: valid.name,
        description: valid.description,
      }),
    });
  }

  submit(quote: SelfPayFeeQuote) {
    return this.manager.submit(quote);
  }

  query(requestId: string) {
    return this.manager.query(requestId);
  }

  /** Polling this method only reads the Human directory; it cannot submit or
   * replay a transaction. */
  async awaitCreated(
    beforeOrganizationIds: readonly string[],
    attempts = 50,
    delayMs = 100,
  ) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const identity = await this.chain.human();
      const organizationId = addedOrganizationId(
        beforeOrganizationIds,
        identity.organizations,
      );
      if (organizationId) return { organizationId, identity };
      if (attempt + 1 < attempts)
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new OrganizationCreateError("organization_not_visible");
  }
}
