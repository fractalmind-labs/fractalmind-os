import type { AgentImportSelection } from "./agent-import";
import type { ConnectionProfile } from "./domain";

export type AgentImportAttempt = {
  id: string;
  deviceProfile: string;
  grantId: string;
  kind: "import" | "rebind";
  target?: { hostAddress: string; instanceId: string };
};
type Store = Pick<Storage, "getItem" | "setItem">;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const id = /^0x[0-9a-f]{64}$/;
const invalid = () =>
  Object.assign(new Error("Import attempt unavailable"), {
    code: "journal_unavailable",
  });

/** Technical correlation only. Workspace or coordinator changes do not give
 * the same physical instance another attempt namespace. Legacy v1 has no
 * target metadata and is retained solely for its separate historical query. */
export function agentImportAttemptKey(
  profile: ConnectionProfile,
  organizationId: string,
  target: AgentImportSelection | null,
) {
  const scope = [
    profile.network,
    profile.chainIdentifier,
    profile.humanId,
    organizationId,
  ];
  return target
    ? `fractalmind.app.agent-import-attempt.v2:${JSON.stringify([...scope, target.hostAddress, target.instanceId])}`
    : `fractalmind.app.agent-import-attempt.v1:${JSON.stringify(scope)}`;
}

export function readAgentImportAttempt(
  store: Store,
  key: string,
  target: AgentImportSelection | null,
): AgentImportAttempt | null {
  const raw = store.getItem(key);
  if (raw === null) return null;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    throw invalid();
  }
  if (
    !saved ||
    !uuid.test(saved.id) ||
    !id.test(saved.grantId) ||
    typeof saved.deviceProfile !== "string" ||
    !/^[A-Za-z0-9_-]{1,64}$/.test(saved.deviceProfile) ||
    (saved.kind !== undefined &&
      saved.kind !== "import" &&
      saved.kind !== "rebind") ||
    (target &&
      (saved.target?.hostAddress !== target.hostAddress ||
        saved.target?.instanceId !== target.instanceId))
  )
    throw invalid();
  return {
    id: saved.id,
    grantId: saved.grantId,
    deviceProfile: saved.deviceProfile,
    kind: saved.kind ?? "import",
    ...(target
      ? {
          target: {
            hostAddress: target.hostAddress,
            instanceId: target.instanceId,
          },
        }
      : {}),
  };
}

export function saveAgentImportAttempt(
  store: Store,
  key: string,
  attempt: AgentImportAttempt,
  target: AgentImportSelection,
) {
  const existing = readAgentImportAttempt(store, key, target);
  if (existing && existing.id !== attempt.id) throw invalid();
  const value = {
    ...attempt,
    target: { hostAddress: target.hostAddress, instanceId: target.instanceId },
  };
  const raw = JSON.stringify(value);
  store.setItem(key, raw);
  if (store.getItem(key) !== raw) throw invalid();
  return readAgentImportAttempt(store, key, target)!;
}
