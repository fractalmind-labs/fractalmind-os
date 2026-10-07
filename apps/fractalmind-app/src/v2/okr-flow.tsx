// App v2 (#75, M2): assigning an OKR to an agent-manager Agent and delivering
// it to the Agent's Home. One signed transaction with its fee on the button;
// delivery writes no chain state and runs on its own once assigned.
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { IndexedDbTransactionJournal, TransactionPreflightError, type SelfPayFeeQuote } from "@fractalmind-labs/fractalmind-sdk";
import { useApp } from "./store";
import { Btn, Icon, sui, useT, type Translate } from "./ui";
import { useLocalSessions } from "./local-agents";
import { ChainReadSession } from "../chain";
import { NativeDeviceError, NativeDeviceSigner } from "../native-device";
import { DeviceIdentityError } from "../device-identity";
import { deviceGrant } from "../device-grant";
import { AgentManagerAssignment, OkrAssignError, AGENT_MANAGER_RUNTIME } from "../okr-assign";
import { deliverOkr, OkrDeliveryError, type Delivered } from "../okr-delivery";
import { awaitTransactionVisible } from "../transaction-visibility";
import { definitionName } from "../agents";
import { agentName } from "../display";
import type { Agent } from "../domain";

export const ERRORS: Record<string, [string, string]> = {
  invalid_grant: ["本设备在此组织没有所需授权（审批与执行）。", "This device lacks the needed grant (approve and operate)."],
  locked: ["设备已锁定，解锁后再试。", "The device is locked. Unlock it and try again."],
  needs_funds: ["本设备余额不足以支付这笔交易。", "This device cannot pay for this transaction."],
  not_assignable: ["目标不是草稿或已暂停状态，或已过截止时间。", "The goal is not a draft or paused, or its deadline has passed."],
  agent_not_controllable: ["这个 Agent 不能接 OKR：需要以 agent-manager 方式导入并确认控制。", "This Agent cannot take OKRs: it must be an agent-manager Agent imported with control."],
  agent_busy: ["这个 Agent 已经有一个进行中的目标。", "This Agent already has an active goal."],
  active_limit: ["进行中的目标已满 3 个。", "Three goals are already active."],
  host_not_member: ["Agent 所在主机已不是有效成员。", "The Agent's host is no longer a valid member."],
  state_changed: ["链上状态刚刚变化，请重新确认。", "Chain state just changed; review again."],
  simulation_failed: ["链上拒绝了这笔交易，请刷新后重试。", "The chain rejected this transaction; refresh and retry."],
  home_unavailable: ["找不到这个 Agent 的 Home 目录。", "This Agent's Home could not be found."],
  delivery_failed: ["写入 Agent Home 失败。", "Writing to the Agent's Home failed."],
  not_active: ["目标还没有进行中。", "The goal is not active yet."],
};
export const errorCode = (e: unknown) =>
  e instanceof OkrAssignError ||
  e instanceof OkrDeliveryError ||
  e instanceof TransactionPreflightError ||
  e instanceof NativeDeviceError ||
  e instanceof DeviceIdentityError
    ? e.code
    : "read_unavailable";
export const errorText = (code: string, t: Translate) =>
  t(...(ERRORS[code] ?? ["没有完成，请稍后重试。", "Not completed; try again shortly."]));

/** Agents that can take an OKR: agent-manager, imported with control. */
export function assignable(agents: Agent[] | null | undefined) {
  return (agents ?? []).filter((a) => !a.revoked && a.control_confirmed && a.runtime === AGENT_MANAGER_RUNTIME);
}

export function useAgentLabel() {
  const app = useApp();
  const sessions = useLocalSessions(app.deviceProfile);
  return {
    sessions,
    label: (a: Agent) => {
      const seen = sessions.find((s) => s.instanceId === a.instance_id);
      return seen?.agent ? definitionName(seen.agent) : agentName(a);
    },
    local: (a: Agent) => sessions.find((s) => s.instanceId === a.instance_id && s.agent) ?? null,
  };
}

async function session(app: ReturnType<typeof useApp>, actions: number[]) {
  if (!app.profile || !app.deviceProfile || !app.snapshot) throw new NativeDeviceError("locked");
  const chain = new ChainReadSession(app.profile);
  const signer = await NativeDeviceSigner.load((c, a) => invoke(c, a), app.deviceProfile);
  const grantId = await deviceGrant(chain, signer.device.address, app.snapshot.organization.objectId, actions);
  return { chain, signer, grantId, organizationId: app.snapshot.organization.objectId };
}

/** Writes the projection into the Agent's Home and notifies it. */
export function useDelivery() {
  const app = useApp();
  const { local } = useAgentLabel();
  return async (okrId: string, agent: Agent): Promise<Delivered | "not_here"> => {
    const here = local(agent);
    if (!here?.agent) return "not_here";
    const s = await session(app, [1]);
    return deliverOkr({
      ...s,
      okrId,
      invoke: (c, a) => invoke(c, a),
      journal: new IndexedDbTransactionJournal(),
      home: here.agent.home,
      agent: here.agent.name || "main",
    });
  };
}

export function DeliveryResult({ result, t }: { result: Delivered | "not_here"; t: Translate }) {
  if (result === "not_here")
    return (
      <div className="note">
        <Icon name="info" />
        <div>
          {t(
            "这个 Agent 不在这台电脑上：请在它所在的电脑打开 FractalMind 投递目标（远程投递即将推出）。",
            "This Agent is not on this computer: open FractalMind on its computer to deliver the goal (remote delivery is coming).",
          )}
        </div>
      </div>
    );
  return (
    <div className={`note ${result.notified ? "" : "warn"}`}>
      <Icon name={result.notified ? "check" : "alert"} />
      <div>
        <div>
          {t("目标已写入", "Goal written to")} <span className="mono small">{result.path}</span>
        </div>
        <div className="small">
          {result.notified
            ? t("已通过 agent-manager 通知 Agent 开始。", "The Agent was told to start through agent-manager.")
            : t(
                `未能通知 Agent（${result.notifyError ?? ""}）。它会在下次心跳读到这个文件。`,
                `Could not notify the Agent (${result.notifyError ?? ""}). It will read the file on its next heartbeat.`,
              )}
        </div>
      </div>
    </div>
  );
}

/** Assign (one signed transaction), then deliver. */
export function AssignFlow({
  okrId,
  agent,
  budgetLimit,
  allowedPaths,
  onAssigned,
}: {
  okrId: string;
  agent: Agent;
  budgetLimit: string;
  allowedPaths: string[];
  onAssigned?: () => void;
}) {
  const app = useApp();
  const t = useT();
  const deliver = useDelivery();
  const { label } = useAgentLabel();
  const [quote, setQuote] = useState<SelfPayFeeQuote | null>(null);
  const [phase, setPhase] = useState<"quoting" | "ready" | "signing" | "delivering" | "done" | "failed">("quoting");
  const [error, setError] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<Delivered | "not_here" | null>(null);
  const flow = useRef<AgentManagerAssignment | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void (async () => {
      try {
        const s = await session(app, [1, 2, 3]);
        flow.current = new AgentManagerAssignment(s.chain, s.signer, s.grantId, s.organizationId, (c, a) => invoke(c, a), new IndexedDbTransactionJournal());
        const q = await flow.current.prepare({ okrId, managedAgentId: agent.id, budgetLimit, allowedPaths });
        if (!live.current) return;
        if ("status" in q) {
          // A prior attempt already settled; continue from its outcome.
          if (q.status === "confirmed") await afterAssigned();
          else {
            setError(q.status === "failed" ? "simulation_failed" : "read_unavailable");
            setPhase("failed");
          }
          return;
        }
        setQuote(q);
        setPhase("ready");
      } catch (e) {
        if (live.current) {
          setError(errorCode(e));
          setPhase("failed");
        }
      }
    })();
    return () => {
      live.current = false;
    };
  }, [okrId, agent.id]);
  async function afterAssigned() {
    onAssigned?.();
    setPhase("delivering");
    try {
      const r = await deliver(okrId, agent);
      if (live.current) setDelivered(r);
    } catch (e) {
      if (live.current) setError(errorCode(e));
    }
    if (live.current) setPhase("done");
  }
  async function sign() {
    if (!quote || !flow.current) return;
    setPhase("signing");
    setError(null);
    try {
      const outcome = await flow.current.submit(quote);
      if (outcome.status !== "confirmed") {
        setError(outcome.status === "failed" ? "simulation_failed" : "read_unavailable");
        setPhase("failed");
        return;
      }
      await awaitTransactionVisible(flow.current.chain, outcome).catch(() => false);
      await afterAssigned();
    } catch (e) {
      if (!live.current) return;
      setError(errorCode(e));
      setPhase("failed");
    }
  }
  return (
    <div className="col">
      <div className="item">
        <span className="avatar round sm">{[...label(agent)][0]?.toUpperCase()}</span>
        <span className="grow">
          <span className="strong">{label(agent)}</span>
          <span className="small muted" style={{ display: "block" }}>
            {t("分配后它负责这个目标，FractalMind 把目标写入它的 Home 并通知它。", "It will own this goal; FractalMind writes the goal into its Home and tells it.")}
          </span>
        </span>
        {phase === "done" && (
          <span className="st ok">
            <Icon name="check" />
            {t("已分配", "Assigned")}
          </span>
        )}
      </div>
      {error && (
        <div className="note warn" role="alert">
          <Icon name="alert" />
          <div>{errorText(error, t)}</div>
        </div>
      )}
      {delivered && <DeliveryResult result={delivered} t={t} />}
      {phase !== "done" && (
        <div className="row">
          <Btn
            kind="primary"
            disabled={phase !== "ready"}
            label={
              phase === "quoting"
                ? t("计算费用…", "Estimating…")
                : phase === "signing"
                  ? t("正在分配…", "Assigning…")
                  : phase === "delivering"
                    ? t("正在投递…", "Delivering…")
                    : phase === "failed"
                      ? t("无法分配", "Cannot assign")
                      : t(`签名分配 · 预计 ${sui(quote!.estimatedGas)}`, `Sign assignment · est. ${sui(quote!.estimatedGas)}`)
            }
            onClick={() => void sign()}
          />
        </div>
      )}
    </div>
  );
}
