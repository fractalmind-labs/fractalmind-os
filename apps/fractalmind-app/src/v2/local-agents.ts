// App v2 (#75): Agents running on this computer, read directly (envd
// --discover: no keychain, no chain). Used to name chain Agents and to know
// which ones can receive a goal here.
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { LocalHostNative } from "../local-host";
import { agentDiscovery, type DiscoveredInstance } from "../agent-discovery";
import { bytesToHex } from "@fractalmind-labs/fractalmind-sdk";
import type { Agent } from "../domain";

const native = new LocalHostNative();

export function useLocalSessions(deviceProfile: string | null) {
  const [sessions, setSessions] = useState<DiscoveredInstance[]>([]);
  useEffect(() => {
    if (!isTauri() || !deviceProfile) return;
    let live = true;
    void (async () => {
      const raw = await native.discover(deviceProfile);
      const d = await agentDiscovery(raw.discovery, raw.observedAtMs, raw.observedAtMs + 60_000);
      if (live) setSessions(d.instances.filter((i) => i.state !== "dead"));
    })().catch(() => {});
    return () => {
      live = false;
    };
  }, [deviceProfile]);
  return sessions;
}

/** The local session of a chain Agent. agent-manager restarts sessions (a new
 * tmux process means a new instance ID), so for an agent-manager Agent the
 * stable identity is its Home, whose hash the chain record pins. */
export function matchLocal(sessions: DiscoveredInstance[], agent: Pick<Agent, "instance_id" | "runtime" | "workspace_hash">) {
  const exact = sessions.find((s) => s.instanceId === agent.instance_id);
  if (exact) return exact;
  if (agent.runtime !== "agent-manager-v1") return null;
  const home = bytesToHex(Uint8Array.from(agent.workspace_hash as ArrayLike<number>));
  return sessions.find((s) => s.agent && s.workspaceHash === home && s.state !== "dead") ?? null;
}
