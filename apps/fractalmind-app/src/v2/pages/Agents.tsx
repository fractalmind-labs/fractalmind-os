// App v2 (#75): Team & Agents (prototype view-agents.js). Chain records are
// the Agents; this computer's scan adds names, Home, model and ROM for the
// ones running here.
import { isTauri } from "@tauri-apps/api/core";
import { useApp } from "../store";
import { useDialogs } from "../dialogs";
import { Btn, Empty, Icon, date, shortId, useLang, useT } from "../ui";
import { okrTitle } from "../model";
import { agentName, hostName } from "../../display";
import { matchLocal, useLocalSessions } from "../local-agents";
import { ChatDrawer } from "../Chat";
import { useState } from "react";
import type { AgentDefinition } from "../../agents";
import { definitionName } from "../../agents";
import type { Agent } from "../../domain";

function controlChip(a: Agent, t: (zh: string, en: string) => string) {
  if (!a.control_confirmed) return <span className="chip wait">{t("仅观察", "Observe only")}</span>;
  return a.runtime === "agent-manager-v1" ? (
    <span className="chip ok">{t("可接 OKR", "Takes OKRs")}</span>
  ) : (
    <span className="chip outline">{t("可控", "Controllable")}</span>
  );
}

export default function Agents() {
  const app = useApp();
  const t = useT();
  const lang = useLang();
  const dialogs = useDialogs();
  const sessions = useLocalSessions(app.deviceProfile);
  const [chat, setChat] = useState<{ name: string; def: AgentDefinition } | null>(null);
  const snapshot = app.snapshot;
  if (!snapshot) return null;
  const agents = (snapshot.agents.value ?? []).filter((a) => !a.revoked);
  const members = snapshot.memberships.value ?? [];
  const okrs = snapshot.okrs.value ?? [];
  const native = isTauri();
  return (
    <>
      <div className="page-h">
        <div>
          <h1>{t("团队与 Agents", "Team & Agents")}</h1>
          <p className="muted">
            {t(
              "Agent、运行实例与所在主机。命令与授权绑定具体实例。",
              "Agents, their running instances and hosts. Commands and grants bind a specific instance.",
            )}
          </p>
        </div>
        <div className="row">
          <Btn
            label={t("从主机导入", "Import from a host")}
            icon="scan"
            disabled={!app.deviceProfile}
            why={t("请先解锁本设备", "Unlock this device first")}
            onClick={() => dialogs.open({ kind: "agent-import" })}
          />
          <Btn
            label={t("新建 Agent", "New Agent")}
            icon="plus"
            kind="primary"
            disabled={!native}
            why={t("需要在桌面 App 中操作", "Needs the desktop App")}
            onClick={() => dialogs.open({ kind: "agent-create" })}
          />
        </div>
      </div>
      {snapshot.agents.value === null ? (
        <div className="note warn">
          <Icon name="help" />
          <div>{t("Agent 记录读取失败，当前数据未知。", "Agent records could not be read; data unknown.")}</div>
        </div>
      ) : !agents.length ? (
        <Empty icon="users" title={t("还没有 Agent", "No Agents yet")}>
          {t(
            "新建一个 Agent（选择 Home、ROM 和模型），或一键导入这台电脑上已经运行的 Agent。",
            "Create an Agent (Home, ROM and model), or import Agents already running on this computer in one click.",
          )}
        </Empty>
      ) : (
        <div className="grid-2">
          {agents.map((a) => {
            const seen = matchLocal(sessions, a);
            const def = seen?.agent ?? null;
            const member = members.find((m) => m.id === a.membership_id);
            const owns = okrs.filter((o) => o.okr.managed_agent === a.id && o.okr.state === 1);
            const name = def ? definitionName(def) : agentName(a);
            return (
              <article className="card" key={a.id}>
                <div className="row between top">
                  <div className="row">
                    <span className="avatar round">{[...name][0]?.toUpperCase()}</span>
                    <div>
                      <div className="strong">{name}</div>
                      <div className="small muted">{member ? hostName(member) : shortId(a.host_address)}</div>
                    </div>
                  </div>
                  {controlChip(a, t)}
                </div>
                <dl className="kv mt-12">
                  <dt>{t("运行时", "Runtime")}</dt>
                  <dd>
                    {def?.launcher ?? a.runtime}
                    {def?.model ? ` → ${def.model}` : ""}
                  </dd>
                  {def && (
                    <>
                      <dt>Home</dt>
                      <dd className="mono small">{def.home}</dd>
                      <dt>ROM</dt>
                      <dd>
                        {def.rom ? (
                          <span className="chip outline mono">
                            {def.rom.name}@{def.rom.version}
                          </span>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </>
                  )}
                  <dt>{t("负责", "Owns")}</dt>
                  <dd>
                    {owns.length
                      ? owns.map((o) => (
                          <a key={o.okr.id} href={`#/okrs/${o.okr.id}`} style={{ display: "block" }}>
                            P{o.okr.priority} {okrTitle(app, o.okr.id)}
                          </a>
                        ))
                      : "—"}
                  </dd>
                  <dt>{t("导入于", "Imported")}</dt>
                  <dd>{date(Number(a.imported_at_ms), lang)}</dd>
                </dl>
                <div className="snap mt-12 small">
                  {a.runtime === "agent-manager-v1"
                    ? t(
                        "FractalMind 投递目标、到期或手动停止、记录进度与证据；工具调用与模型花费由它自己的启动配置决定。",
                        "FractalMind delivers goals, stops on deadline or request and records progress and evidence; tool use and model spending follow its own launch configuration.",
                      )
                    : a.control_confirmed
                      ? t("受 FractalMind 约束执行。", "Runs under FractalMind's constraints.")
                      : t("只能观察：不能承接 OKR。", "Observe only: cannot own OKRs.")}
                </div>
                <div className="row wrap mt-12">
                  <Btn
                    label={t("对话", "Chat")}
                    icon="message"
                    size="sm"
                    kind={def ? "primary" : ""}
                    disabled={!def}
                    why={t("目前只能和这台电脑上的 agent-manager Agent 对话", "For now you can chat with agent-manager Agents on this computer")}
                    onClick={() => def && setChat({ name, def })}
                  />
                  <Btn
                    label={t("常驻权限", "Standing permission")}
                    icon="shield"
                    size="sm"
                    disabled
                    why={t(
                      "即将推出：常驻权限是链上记录，需要升级 direct-agent 合约；agent-manager Agent 的工具调用也无法由 FractalMind 强制。",
                      "Coming soon: standing permission is a chain record that needs a direct-agent upgrade, and an agent-manager Agent's tool use cannot be enforced by FractalMind.",
                    )}
                  />
                </div>
              </article>
            );
          })}
        </div>
      )}
      {agents.length > 0 && (
        <section className="sec">
          <div className="sec-h">
            <h2>{t("运行实例", "Instances")}</h2>
            <span className="small muted">{agents.length}</span>
          </div>
          <div className="card flush" style={{ overflowX: "auto" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("实例", "Instance")}</th>
                  <th>{t("主机", "Host")}</th>
                  <th>{t("运行时", "Runtime")}</th>
                  <th>{t("控制", "Control")}</th>
                  <th>{t("状态", "Status")}</th>
                  <th>OKR</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const member = members.find((m) => m.id === a.membership_id);
                  const seen = matchLocal(sessions, a);
                  // Only this computer's own scan proves it is running here.
                  const here = !!seen && seen.state !== "dead";
                  const owns = okrs.filter((o) => o.okr.managed_agent === a.id && o.okr.state === 1);
                  return (
                    <tr key={a.id}>
                      <td>
                        <div className="strong">{seen?.agent ? definitionName(seen.agent) : agentName(a)}</div>
                        <div className="tiny muted mono">{seen?.session ?? shortId(a.instance_id, 10)}</div>
                      </td>
                      <td>
                        <a href={`#/hosts/${a.host_address}`}>{member ? hostName(member) : shortId(a.host_address)}</a>
                      </td>
                      <td className="small">{a.runtime}</td>
                      <td>{controlChip(a, t)}</td>
                      <td>
                        {here ? (
                          <span className="st ok">{t("运行", "Running")}</span>
                        ) : (
                          <span className="st muted">
                            <Icon name="help" />
                            {t("未知", "Unknown")}
                          </span>
                        )}
                      </td>
                      <td className="small">{owns.map((o) => `P${o.okr.priority} ${okrTitle(app, o.okr.id).slice(0, 12)}`).join(", ") || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {chat && <ChatDrawer name={chat.name} def={chat.def} onClose={() => setChat(null)} />}
    </>
  );
}
