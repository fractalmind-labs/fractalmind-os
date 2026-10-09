// Display names shared by the shell and views. Prototype v2 shows readable
// names first; chain IDs appear only shortened, as secondary detail.

type Translate = (zh: string, en: string) => string;

/** First 8 and last 6 characters of a chain ID, or an em dash. */
export const shortId = (id?: string | null) =>
  id ? (id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id) : "—";

/** A Host membership's name, falling back to its shortened address. */
export const hostName = (member: { name?: string | null; host_address: string }) =>
  member.name?.trim() || shortId(member.host_address);

/** A managed Agent instance: runtime plus a shortened instance ID. */
export const agentName = (agent: { runtime: string; instance_id: string }) =>
  `${agent.runtime} · ${
    agent.instance_id.length > 18
      ? `${agent.instance_id.slice(0, 14)}…`
      : agent.instance_id
  }`;

const ACTIONS: Record<string, [string, string]> = {
  ask: ["提问", "Ask"],
  status: ["查看状态", "Check status"],
  "file.read": ["读取文件", "Read files"],
  "file.write": ["写入文件", "Write files"],
};

/** A direct-message action as a readable label; unknown actions stay as-is. */
export const actionLabel = (action: string, t: Translate) =>
  ACTIONS[action] ? t(...ACTIONS[action]) : action;

/** Avatar initial for an organization or person name. */
export const initial = (name: string) =>
  [...name.trim()][0]?.toUpperCase() ?? "?";
