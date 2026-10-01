// Client for the envd coordinator REST API.
//
// The coordinator exposes (bearer-token auth on /api/*):
//   GET  /api/health
//   GET  /api/sentinels
//   GET  /api/sentinels/{id}
//   GET  /api/sentinels/{id}/agents
//   POST /api/sentinels/{id}/command   { node_command: SignedNodeCommand }
//
// This client is transport-agnostic (plain fetch) so it runs unchanged inside
// Tauri (desktop) and Capacitor (mobile) WebViews.

import type { SignedNodeCommand } from '../../../../protocols/fractalmind-protocol/sdk/src/node-command-wire';

export type ControlAction = 'inventory' | 'status' | 'start' | 'stop' | 'assign' | 'monitor' | 'logs' | 'health' | 'availability';
export type ControlCommandSigner = (intent: {
  nodeId: string; agentId: string; action: ControlAction; payload: Record<string, unknown>;
}) => Promise<SignedNodeCommand>;

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
  // Optional public URL of this node's envd-desktop server, advertised by the
  // worker. When present the App opens the desktop viewer without prompting.
  desktop_url?: string | null;
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

export interface DesktopQuality {
  encode_height: number;
  bitrate: string;
  fps: number;
}

export interface DesktopStatus {
  ok: boolean;
  turn_enabled: boolean;
  ice_servers: number;
  session?: {
    active: boolean;
    ice_state: string;
    streaming: boolean;
    frames_sent: number;
    bytes_sent: number;
    connected_at?: string;
    started_at?: string;
    last_frame_at?: string;
    last_error?: string;
    capture_width: number;
    capture_height: number;
    encode_height: number;
    fps: number;
  };
}

export class CoordinatorClient {
  constructor(
    private baseURL: string,
    private token: string,
    private commandSigner?: ControlCommandSigner,
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

  setCommandSigner(signer: ControlCommandSigner | undefined): void {
    this.commandSigner = signer;
  }

  canSendCommands(): boolean { return Boolean(this.commandSigner); }

  /** Build a device-signed intent; a transport token alone grants no action. */
  async sendCommand(
    id: string,
    action: ControlAction,
    agentId = "",
    args = "",
    nodeId = id,
  ): Promise<CommandResult> {
    if (!this.commandSigner) throw new Error('Connect an authorized signing device to run commands.');
    const nodeWide = action === 'inventory' || action === 'health';
    if (!nodeWide && !agentId.trim()) throw new Error('Agent instance is required.');
    const payload: Record<string, unknown> = {};
    if (action === 'assign') {
      if (!args.trim()) throw new Error('A task is required.');
      payload.task = args;
    } else if (action === 'logs' || action === 'monitor') {
      const lines = args.trim() ? Number(args) : 100;
      if (!Number.isInteger(lines) || lines < 1 || lines > 1000) throw new Error('Log lines must be between 1 and 1000.');
      payload.lines = lines;
    }
    const command = await this.commandSigner({ nodeId, agentId: nodeWide ? '' : agentId, action, payload });
    if (command.target.node_id !== nodeId || command.target.agent_id !== (nodeWide ? undefined : agentId) || command.action !== action) {
      throw new Error('Signed target does not match the selected host and instance.');
    }
    return this.sendSignedCommand(id, command);
  }

  sendSignedCommand(id: string, command: SignedNodeCommand): Promise<CommandResult> {
    return this.req(`/api/sentinels/${encodeURIComponent(id)}/command`, {
      method: "POST",
      body: JSON.stringify({ node_command: command }),
    });
  }

  /**
   * Remote-desktop signaling relayed through the coordinator to the node's
   * envd-desktop server. The console never talks to the desktop directly, so
   * there is no tunnel, no cross-origin fetch, and no desktop URL/token to
   * configure — the coordinator bearer token authorizes everything.
   */
  desktopICE(id: string): Promise<{ iceServers: RTCIceServer[] }> {
    return this.req(`/api/sentinels/${encodeURIComponent(id)}/desktop/ice`);
  }

  desktopStatus(id: string): Promise<DesktopStatus> {
    return this.req(`/api/sentinels/${encodeURIComponent(id)}/desktop/status`);
  }

  desktopOffer(
    id: string,
    offer: RTCSessionDescriptionInit,
    quality?: DesktopQuality,
  ): Promise<{ answer: RTCSessionDescriptionInit }> {
    return this.req(`/api/sentinels/${encodeURIComponent(id)}/desktop/offer`, {
      method: "POST",
      body: JSON.stringify({ offer, quality }),
    });
  }
}
