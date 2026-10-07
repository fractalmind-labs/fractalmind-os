import { invoke } from "@tauri-apps/api/core";

/** New Agents from bundled ROMs (#67). An Agent is a Home directory: the ROM
 * writes its Agent OS files and skills, AGENTS.md names it and says how to
 * launch it, and agent-manager runs it in tmux as `<name>--main`. */
export type RomSkill = {
  name: string;
  description: string;
  available: boolean;
  embedded?: string;
  bundled?: string;
};
export type Rom = {
  id: string;
  family: string;
  version: string;
  compat: string;
  description: string;
  files: string[];
  directories: string[];
  included: RomSkill[];
  optional: RomSkill[];
};
export type RomCatalog = { format: 1; runtimeSkill: string; roms: Rom[] };
export type LauncherProfile = { id: string; model: string | null };
export type Launcher = {
  id: "codex" | "claude" | string;
  name: string;
  bin: string;
  profiles: LauncherProfile[];
};
export type HomeState =
  "new" | "empty" | "agent_home" | "not_empty" | "invalid";
export type AgentSpec = {
  name: string;
  home: string;
  romId: string;
  optionalSkills: string[];
  launcher: string;
  profileId: string;
};
export type CreatedAgent = {
  home: string;
  session: string;
  files: string[];
  skills: string[];
  missingSkills: string[];
  heartbeat: boolean;
  started: boolean;
  startError: string | null;
  heartbeatInstalled: boolean;
  heartbeatError: string | null;
};
export type StartOutcome = {
  heartbeatInstalled: boolean;
  heartbeatError: string | null;
};
/** The agent-manager definition envd read from a discovered session's Home. */
export type AgentDefinition = {
  home: string;
  name: string;
  namespace: string | null;
  description: string | null;
  launcher: string | null;
  profile: string | null;
  model: string | null;
  heartbeat: string | null;
  schedules: number;
  rom: { name: string; version: string } | null;
  skills: number;
  subAgents: number;
};

export class AgentError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
  ) {
    super(code);
  }
}
type Invoke = <T>(
  command: string,
  args?: Record<string, unknown>,
) => Promise<T>;
export class AgentNative {
  constructor(private readonly call: Invoke = invoke) {}
  private async run<T>(command: string, args?: Record<string, unknown>) {
    try {
      return await this.call<T>(command, args);
    } catch (e) {
      const text =
        typeof e === "string" ? e : e instanceof Error ? e.message : "";
      const [code, ...rest] = text.split(": ");
      throw new AgentError(
        code || "native_failed",
        rest.join(": ") || undefined,
      );
    }
  }
  catalog() {
    return this.run<RomCatalog>("fm_agent_catalog");
  }
  launchers() {
    return this.run<Launcher[]>("fm_agent_launchers");
  }
  checkHome(home: string) {
    return this.run<{ state: HomeState; path: string | null }>(
      "fm_agent_home_check",
      { home },
    );
  }
  create(spec: AgentSpec) {
    return this.run<CreatedAgent>("fm_agent_create", { spec });
  }
  start(home: string) {
    return this.run<StartOutcome>("fm_agent_start", { home });
  }
}

/** Becomes the namespace and the tmux session `<name>--main`. */
export function validAgentName(name: string) {
  return (
    /^[a-z][a-z0-9-]{1,30}$/.test(name) &&
    !name.endsWith("-") &&
    !name.includes("--")
  );
}
export function sessionName(name: string) {
  return `${name}--main`;
}
/** Names already used by Agents discovered on the host or in the org. */
export function nameTaken(name: string, used: Iterable<string>) {
  for (const n of used) if (n.toLowerCase() === name) return true;
  return false;
}
export function defaultHome(name: string) {
  return name ? `~/agents/${name}` : "";
}

function text(value: unknown, max: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    new TextEncoder().encode(value).length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new Error("invalid definition");
  return value;
}
function count(value: unknown, max: number): number {
  if (value === undefined) return 0;
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 0 ||
    (value as number) > max
  )
    throw new Error("invalid definition");
  return value as number;
}
/** An invalid definition is dropped, never trusted; the instance stays. */
export function agentDefinition(value: unknown): AgentDefinition | null {
  if (value === undefined || value === null) return null;
  try {
    if (typeof value !== "object" || Array.isArray(value)) return null;
    const v = value as Record<string, unknown>;
    const home = text(v.home, 4096),
      name = text(v.name, 128);
    if (!home || !home.startsWith("/") || !name) return null;
    const rom =
      v.rom && typeof v.rom === "object" && !Array.isArray(v.rom)
        ? (v.rom as Record<string, unknown>)
        : null;
    const romName = rom ? text(rom.name, 128) : null;
    return {
      home,
      name,
      namespace: text(v.namespace, 64),
      description: text(v.description, 512),
      launcher: text(v.launcher, 512),
      profile: text(v.profile, 64),
      model: text(v.model, 128),
      heartbeat: text(v.heartbeat, 128),
      schedules: count(v.schedules, 1000),
      rom: romName
        ? { name: romName, version: text(rom!.version, 64) ?? "" }
        : null,
      skills: count(v.skills, 10000),
      subAgents: count(v.sub_agents, 1000),
    };
  } catch {
    return null;
  }
}
/** What the App calls a discovered Agent: its namespace, else its name. */
export function definitionName(def: AgentDefinition) {
  return def.namespace ?? def.name;
}
