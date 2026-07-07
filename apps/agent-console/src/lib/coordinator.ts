// Client for the envd coordinator REST API.
//
// The coordinator exposes (bearer-token auth on /api/*):
//   GET  /api/health
//   GET  /api/sentinels
//   GET  /api/sentinels/{id}
//   GET  /api/sentinels/{id}/agents
//   POST /api/sentinels/{id}/command   { command, agent_id, args }
//
// This client is transport-agnostic (plain fetch) so it runs unchanged inside
// Tauri (desktop) and Capacitor (mobile) WebViews.

export interface SystemInfo {
  hostname?: string;
  os?: string;
  arch?: string;
  cpu_percent?: number;
  mem_percent?: number;
  [k: string]: unknown;
}

export interface Agent {
  id?: string;
  name?: string;
  session?: string;
  status?: string;
  [k: string]: unknown;
}

export interface Sentinel {
  id: string;
  host_id: string;
  hostname: string;
  version: string;
  connected_at: string;
  last_heartbeat: string | null;
  agent_count: number;
  uptime_seconds: number;
  system?: SystemInfo | null;
}

export interface CommandResult {
  success: boolean;
  error?: string;
  message?: string;
  output?: string;
  logs?: string;
  agents?: Agent[];
  [k: string]: unknown;
}

export class CoordinatorClient {
  constructor(
    private baseURL: string,
    private token: string,
  ) {
    // Normalize: drop trailing slash so path joins are predictable.
    this.baseURL = baseURL.replace(/\/+$/, "");
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string>),
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (init?.body) headers["Content-Type"] = "application/json";

    const resp = await fetch(this.baseURL + path, { ...init, headers });
    if (resp.status === 401) throw new Error("unauthorized (check token)");
    if (!resp.ok) {
      let msg = `HTTP ${resp.status}`;
      try {
        const j = await resp.json();
        if (j?.error) msg = j.error;
      } catch {
        /* non-JSON body */
      }
      throw new Error(msg);
    }
    return (await resp.json()) as T;
  }

  /** Health + reachability probe. */
  health(): Promise<{ status: string; sentinels: number; total_agents: number }> {
    return this.req("/api/health");
  }

  listSentinels(): Promise<{ sentinels: Sentinel[]; count: number }> {
    return this.req("/api/sentinels");
  }

  getSentinel(id: string): Promise<Sentinel> {
    return this.req(`/api/sentinels/${encodeURIComponent(id)}`);
  }

  getAgents(id: string): Promise<{ agents: Agent[]; count: number }> {
    return this.req(`/api/sentinels/${encodeURIComponent(id)}/agents`);
  }

  /** Send a control command (status | logs | restart | kill | shell) to a node. */
  sendCommand(
    id: string,
    command: string,
    agentId = "",
    args = "",
  ): Promise<CommandResult> {
    return this.req(`/api/sentinels/${encodeURIComponent(id)}/command`, {
      method: "POST",
      body: JSON.stringify({ command, agent_id: agentId, args }),
    });
  }
}
