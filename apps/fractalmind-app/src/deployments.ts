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
