import { requestSuiFromFaucetV2, getFaucetHost } from "@mysten/sui/faucet";
import { normalizeDeployment, type DeploymentProfile } from "./onboarding";

/** Build-time configuration. Official networks will ship their published
 * deployment here; development builds point at a local network through
 * `.env.local` (not committed):
 *
 *   VITE_FRACTALMIND_DEPLOYMENT={"network":"localnet","rpcUrl":…,"packageId":…}
 *   VITE_FRACTALMIND_FAUCET=http://127.0.0.1:29123
 */
const env = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;

/** Parses a public deployment description; null when absent or invalid. */
export function parseDeployment(
  text: string | undefined,
): DeploymentProfile | null {
  if (!text?.trim()) return null;
  try {
    return normalizeDeployment(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The deployment this build targets, if one was configured. */
export const builtInDeployment = parseDeployment(
  env?.VITE_FRACTALMIND_DEPLOYMENT,
);

/** Where test funds come from: an explicit faucet for local networks, the
 * public devnet faucet, otherwise none (funds must be sent manually). */
export function faucetHost(
  network: DeploymentProfile["network"],
  configured = env?.VITE_FRACTALMIND_FAUCET,
): string | null {
  if (configured?.trim() && (network === "localnet" || network === "devnet"))
    return configured.trim().replace(/\/+$/, "");
  if (network === "devnet") return getFaucetHost("devnet");
  return null;
}

/** Requests test SUI for each address. Never used on mainnet or testnet. */
export async function requestTestFunds(host: string, recipients: string[]) {
  for (const recipient of recipients)
    await requestSuiFromFaucetV2({ host, recipient });
}

/** A profile saved before a compatible package upgrade keeps calling the old
 * package. When this build targets the same registry and the same package
 * lineage (identical original IDs), the saved profile adopts the build's newer
 * call packages; anything else is left untouched. */
export function withBuiltInUpgrade<
  P extends DeploymentProfile & { humanId: string },
>(profile: P, built: DeploymentProfile | null = builtInDeployment): P {
  if (
    !built ||
    built.network !== profile.network ||
    built.registryId !== profile.registryId
  )
    return profile;
  const origin = (original?: string, call?: string) => original ?? call;
  const same =
    origin(built.originalPackageId, built.packageId) ===
      origin(profile.originalPackageId, profile.packageId) &&
    origin(built.originalOkrPackageId, built.okrPackageId) ===
      origin(profile.originalOkrPackageId, profile.okrPackageId) &&
    origin(built.originalDirectPackageId, built.directPackageId) ===
      origin(profile.originalDirectPackageId, profile.directPackageId);
  if (!same) return profile;
  return {
    ...profile,
    packageId: built.packageId,
    originalPackageId: built.originalPackageId,
    okrPackageId: built.okrPackageId,
    originalOkrPackageId: built.originalOkrPackageId,
    directPackageId: built.directPackageId,
    originalDirectPackageId: built.originalDirectPackageId,
  };
}
