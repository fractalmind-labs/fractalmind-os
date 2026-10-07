import type { TransactionJournal } from "@fractalmind-labs/fractalmind-sdk";
import type { ChainReadSession } from "./chain";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { NativeDeviceSigner, NativeInvoke } from "./native-device";
import { OkrIntervention } from "./okr-intervention";
import { OkrProjection } from "./okr-projection";

/** Delivering an assigned OKR to an agent-manager Agent on this computer
 * (#75): the projection is read fresh from chain, written into the Agent's
 * Home and handed to it through agent-manager. No chain write. */
export type Delivered = { path: string; notified: boolean; notifyError: string | null };
export class OkrDeliveryError extends Error {
  constructor(readonly code: "not_active" | "home_unavailable" | "delivery_failed") {
    super(code);
  }
}

/** The agent-facing task. `{OKR_PATH}` is replaced by the file actually written. */
export function deliveryTask(input: { objective: string; deadlineMs: string; okrId: string }) {
  const due = new Date(Number(input.deadlineMs)).toISOString().slice(0, 10);
  return [
    "FractalMind assigned you a goal.",
    "",
    `Objective: ${input.objective}`,
    `Deadline: ${due} (FractalMind stops this goal at the deadline or when the owner stops it).`,
    "",
    "Read {OKR_PATH}: it is the OKR projection from the Sui chain. Its chain facts are read-only;",
    "work toward the key results in order, inside the allowed paths it lists.",
    "Report progress, evidence, blockers and next steps in HEARTBEAT.md as the projection describes.",
    "Your reports are recorded as Agent-claimed until the owner verifies and accepts them.",
    "",
    `OKR ID: ${input.okrId}`,
  ].join("\n");
}

export async function deliverOkr(input: {
  chain: ChainReadSession;
  signer: NativeDeviceSigner;
  grantId: string;
  organizationId: string;
  okrId: string;
  invoke: NativeInvoke;
  journal: TransactionJournal;
  home: string;
  agent: string;
  /** Tests replace the native call. */
  native?: (command: string, args: Record<string, unknown>) => Promise<unknown>;
}): Promise<Delivered> {
  const projection = new OkrProjection(
    new OkrIntervention(input.chain, input.signer, input.grantId, input.organizationId, input.okrId, input.invoke, input.journal),
  );
  const view = await projection.read();
  if (view.snapshot.state !== "ACTIVE") throw new OkrDeliveryError("not_active");
  const file = await projection.export(view, { reviewed: true });
  const task = deliveryTask({
    objective: view.snapshot.specification.objective,
    deadlineMs: view.snapshot.specification.deadlineMs,
    okrId: input.okrId,
  });
  const native = input.native ?? ((c: string, a: Record<string, unknown>) => tauriInvoke(c, a));
  let out: unknown;
  try {
    out = await native("fm_agent_deliver_okr", {
      delivery: { home: input.home, agent: input.agent, content: file.content, task },
    });
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e);
    throw new OkrDeliveryError(/Home|InvalidHome/.test(text) ? "home_unavailable" : "delivery_failed");
  }
  const d = out as Delivered;
  if (!d || typeof d.path !== "string" || typeof d.notified !== "boolean") throw new OkrDeliveryError("delivery_failed");
  return { path: d.path, notified: d.notified, notifyError: d.notifyError ?? null };
}
