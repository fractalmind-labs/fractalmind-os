import { agentDefinition, type AgentDefinition } from "./agents";

/** Read only from independently verified Host body bytes. A pane is an
 * observation target, not an independently authenticated AI Agent. */
export type DiscoveredInstance = {
  instanceId: string;
  session: string;
  pane: string;
  state: "observed" | "unverified" | "dead";
  runtime: "tmux-observe" | "bounded-process-v1";
  continuity: "kernel-process-v1" | "envd-process-v1" | "unverified";
  workspace: string;
  workspaceHash: string;
  /** The Home's AGENTS.md definition as observed by the Host, if any. */
  agent: AgentDefinition | null;
};
export type AgentDiscovery = {
  state: "complete" | "unavailable" | "unsupported" | "unknown" | "expired";
  observedAtMs: number | null;
  expiresAtMs: number | null;
  freshUntilMs: number | null;
  instances: DiscoveredInstance[];
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid discovery");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error("invalid discovery");
  return value;
}
export async function agentDiscovery(
  value: unknown,
  heartbeatMs: number,
  hostExpiresAtMs: number,
  sourceKind: "tmux" | "native" = "tmux",
): Promise<AgentDiscovery> {
  const unknown: AgentDiscovery = {
    state: "unknown",
    observedAtMs: null,
    expiresAtMs: null,
    freshUntilMs: null,
    instances: [],
  };
  try {
    const source = object(value),
      timestamp = text(source.observed_at, 64);
    const observedAtMs = Date.parse(timestamp);
    if (
      source.format !== 1 ||
      !/^\d{4}-\d\d-\d\dT/.test(timestamp) ||
      !Number.isSafeInteger(observedAtMs) ||
      observedAtMs < 0 ||
      observedAtMs > heartbeatMs + 5000 ||
      !["complete", "unavailable", "unsupported"].includes(
        String(source.state),
      ) ||
      !Array.isArray(source.instances) ||
      source.instances.length > 1000
    )
      return unknown;
    const state = source.state as "complete" | "unavailable" | "unsupported";
    if (state !== "complete" && source.instances.length) return unknown;
    const instances: DiscoveredInstance[] = [],
      seen = new Set<string>(),
      panes = new Set<string>();
    for (const value of source.instances) {
      const r = object(value),
        instanceId = text(r.instance_id, 128),
        session = text(r.session, 256),
        pane = text(r.pane, 64),
        workspace = text(r.workspace, 4096),
        workspaceHash = text(r.workspace_hash, 64);
      if (
        !session ||
        (sourceKind === "tmux"
          ? !/^%[0-9]+$/.test(pane) ||
            panes.has(pane) ||
            r.runtime !== "tmux-observe"
          : pane !== "" ||
            r.runtime !== "bounded-process-v1" ||
            r.state !== "observed") ||
        !["observed", "unverified", "dead"].includes(String(r.state))
      )
        return unknown;
      panes.add(pane);
      if (r.state === "observed") {
        if (
          (sourceKind === "tmux"
            ? r.continuity !== "kernel-process-v1" ||
              !/^tmux-[0-9a-f]{64}$/.test(instanceId)
            : r.continuity !== "envd-process-v1" ||
              !/^native-[0-9a-f]{64}$/.test(instanceId)) ||
          !workspace.startsWith("/") ||
          !/^[0-9a-f]{64}$/.test(workspaceHash) ||
          seen.has(instanceId)
        )
          return unknown;
        const hash = Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(workspace),
            ),
          ),
          (x) => x.toString(16).padStart(2, "0"),
        ).join("");
        if (hash !== workspaceHash) return unknown;
        seen.add(instanceId);
      } else if (
        r.continuity !== "unverified" ||
        instanceId ||
        workspace ||
        workspaceHash
      )
        return unknown;
      instances.push({
        instanceId,
        session,
        pane,
        state: r.state as DiscoveredInstance["state"],
        runtime: r.runtime as DiscoveredInstance["runtime"],
        continuity: r.continuity as DiscoveredInstance["continuity"],
        workspace,
        workspaceHash,
        agent: r.state === "observed" ? agentDefinition(r.agent) : null,
      });
    }
    return {
      state,
      observedAtMs,
      expiresAtMs: Math.min(hostExpiresAtMs, observedAtMs + 60000),
      freshUntilMs: null,
      instances,
    };
  } catch {
    return unknown;
  }
}
