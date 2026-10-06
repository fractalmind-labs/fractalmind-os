/** The network and registry this build targets (VITE_FRACTALMIND_DEPLOYMENT).
 * Kept free of other imports so device and storage helpers can use it. */
const env = (
  import.meta as ImportMeta & { env?: Record<string, string | undefined> }
).env;

export type BuildTarget = Readonly<{ network: string; registryId: string }>;

export function parseBuildTarget(text: string | undefined): BuildTarget | null {
  try {
    const value = JSON.parse(text ?? "null");
    if (
      value &&
      typeof value.network === "string" &&
      typeof value.registryId === "string"
    )
      return Object.freeze({
        network: value.network,
        registryId: value.registryId.toLowerCase(),
      });
  } catch {}
  return null;
}

export const buildTarget = parseBuildTarget(env?.VITE_FRACTALMIND_DEPLOYMENT);

/** Device keys are per profile and a setup's recovery code is bound to one
 * network, so each network gets its own default profile on this machine. */
export function defaultProfileFor(target: BuildTarget | null) {
  return !target || target.network === "localnet" ? "primary" : target.network;
}
export const defaultDeviceProfile = defaultProfileFor(buildTarget);

/** Whether stored records (setup, connection) belong to this build's target.
 * Without a built-in target every record is accepted. */
export function matchesTarget(
  value: { network?: unknown; registryId?: unknown } | null | undefined,
  target: BuildTarget | null = buildTarget,
  { registry = true }: { registry?: boolean } = {},
) {
  if (!target) return true;
  if (!value || value.network !== target.network) return false;
  return (
    !registry ||
    (typeof value.registryId === "string" &&
      value.registryId.toLowerCase() === target.registryId)
  );
}
