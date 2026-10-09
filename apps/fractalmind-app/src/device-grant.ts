import type { ChainReadSession } from "./chain";
import { DeviceIdentityError } from "./device-identity";

/** The one current grant this device holds for the organization with all the
 * given actions (1 = read, 4 = manage hosts). An organization-scoped grant
 * wins over a global one; anything ambiguous is refused. */
export async function deviceGrant(
  chain: ChainReadSession,
  device: string,
  organizationId: string,
  actions: number[],
) {
  const human = await chain.human();
  const candidates = human.grants.value?.filter(
    (g) =>
      g.device === device &&
      !g.revoked &&
      g.generation === human.human.generation &&
      actions.every((a) => g.actions.includes(a)) &&
      BigInt(g.expires_at_ms) > human.clockMs &&
      (g.org_scope === null || g.org_scope === organizationId),
  );
  const scoped = candidates?.filter((g) => g.org_scope === organizationId),
    usable = scoped?.length ? scoped : candidates;
  if (usable?.length !== 1) throw new DeviceIdentityError("invalid_grant");
  return usable[0].id;
}
