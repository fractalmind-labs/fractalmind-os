// App v2 (#75): Agents running on this computer, read directly (envd
// --discover: no keychain, no chain). Used to name chain Agents and to know
// which ones can receive a goal here.
import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { LocalHostNative } from "../local-host";
import { agentDiscovery, type DiscoveredInstance } from "../agent-discovery";

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
