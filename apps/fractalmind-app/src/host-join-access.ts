/**
 * Host access string (`FMJ1:`) for `fractalmind-envd join`: the public
 * connection configuration plus the one-use invitation, so a new Host needs
 * one paste. The whole string is a bearer secret; show it once, never store it.
 * The format is parsed by runtime/fractalmind-envd/cmd/envd/host_join_access.go.
 */
export const HOST_JOIN_ACCESS_PREFIX = "FMJ1:";
/** Gas the invitation carries for the joining Host (0.05 SUI). */
export const INVITE_GAS_MIST = 50_000_000n;
/** The Host's self-paid join budget; the invitation Gas covers it. */
export const HOST_JOIN_GAS_BUDGET = 30_000_000;

export type HostJoinAccessProfile = {
  network: string;
  rpcUrl: string;
  chainIdentifier?: string;
  packageId: string;
  originalPackageId?: string;
  okrPackageId?: string;
  originalOkrPackageId?: string;
  directPackageId?: string;
  originalDirectPackageId?: string;
  registryId: string;
};

export function encodeHostJoinAccess(
  profile: HostJoinAccessProfile,
  organizationId: string,
  chainIdentifier: string,
  inviteCode: string,
): string {
  // Same defaults as the manual admission guide in HostAccess.
  const original = profile.originalPackageId ?? profile.packageId;
  const okr = profile.okrPackageId ?? profile.packageId;
  const direct = profile.directPackageId ?? profile.packageId;
  const payload = {
    v: 1,
    network: profile.network,
    rpc: profile.rpcUrl,
    chain_identifier: chainIdentifier,
    protocol_package_id: profile.packageId,
    protocol_original_package_id: original,
    okr_package_id: okr,
    okr_original_package_id:
      profile.originalOkrPackageId ?? profile.okrPackageId ?? original,
    direct_package_id: direct,
    direct_original_package_id:
      profile.originalDirectPackageId ?? profile.directPackageId ?? original,
    protocol_registry_id: profile.registryId,
    org_id: organizationId,
    host_join_gas_budget: HOST_JOIN_GAS_BUDGET,
    invite: inviteCode,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64url = btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return HOST_JOIN_ACCESS_PREFIX + base64url;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Short value the operator compares between the App and the joining Host,
 * derived from the organization and the Coordinator entry the invitation uses.
 */
export async function hostJoinFingerprint(
  organizationId: string,
  bindingId: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        `fractalmind.host-join-fingerprint.v1\n${organizationId}\n${bindingId}`,
      ),
    ),
  );
  let bits = 0n;
  for (const b of digest.slice(0, 5)) bits = (bits << 8n) | BigInt(b);
  let out = "";
  for (let i = 7; i >= 0; i--)
    out += CROCKFORD[Number((bits >> BigInt(5 * i)) & 31n)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** Above this network fee the one-click invitation shows the full quote. */
export const QUICK_INVITE_MAX_FEE_MIST = 10_000_000n;

/**
 * The one-click invitation submits without a separate fee panel only when the
 * fee is small and the transaction moves no SUI beyond the invitation's Gas.
 */
export function quickInviteWithinLimits(quote: {
  estimatedGas: string;
  simulatedSuiSpend: string;
}): boolean {
  try {
    return (
      BigInt(quote.estimatedGas) <= QUICK_INVITE_MAX_FEE_MIST &&
      BigInt(quote.simulatedSuiSpend) <= INVITE_GAS_MIST
    );
  } catch {
    return false;
  }
}
