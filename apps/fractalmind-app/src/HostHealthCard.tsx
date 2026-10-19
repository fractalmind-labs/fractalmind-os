import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  IndexedDbTransactionJournal,
  type SelfPayFeeQuote,
} from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "./chain";
import { deviceGrant } from "./device-grant";
import {
  HostHealthError,
  NativeHostHealth,
  type HostHealthResult,
} from "./host-health";
import { NativeDeviceSigner } from "./native-device";
import type { ConnectionProfile } from "./domain";

type Translate = (zh: string, en: string) => string;
/** Above this network fee the second transaction asks again. */
const AUTO_FEE_MIST = 10_000_000n;
const POLL_MS = 3_000;
const POLL_LIMIT = 60;

type Phase =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "confirm"; quote: SelfPayFeeQuote; step: "capability" | "command" }
  | {
      kind: "done";
      result: Extract<HostHealthResult, { state: "finished" }>;
      runId: string;
    }
  | { kind: "error"; code: string; runId?: string };

/** Runs this Host's configured health probes as an authorized, receipted
 * command and shows each probe's result. */
export default function HostHealthCard({
  profile,
  organizationId,
  deviceProfile,
  membershipId,
  t,
}: {
  profile: ConnectionProfile;
  organizationId: string;
  deviceProfile: string | null;
  membershipId: string;
  t: Translate;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const session = useRef<NativeHostHealth | null>(null);
  const command = useRef<
    Awaited<ReturnType<NativeHostHealth["quoteCommand"]>>["command"] | null
  >(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const set = (p: Phase) => mounted.current && setPhase(p);
  const fail = (e: unknown, runId?: string) =>
    set({
      kind: "error",
      code:
        e instanceof HostHealthError
          ? e.code
          : ((e as { code?: string })?.code ?? "operation_failed"),
      runId,
    });

  async function open() {
    const chain = new ChainReadSession(profile);
    const signer = await NativeDeviceSigner.load(
      (c, a) => invoke(c, a),
      deviceProfile!,
    );
    const grantId = await deviceGrant(
      chain,
      signer.device.address,
      organizationId,
      [1],
    );
    session.current = new NativeHostHealth(
      chain,
      signer,
      grantId,
      organizationId,
      membershipId,
      (c, a) => invoke(c, a),
      new IndexedDbTransactionJournal(),
    );
    return session.current;
  }
  async function start() {
    try {
      set({
        kind: "busy",
        step: t("核对授权并报价", "Checking authority and fee"),
      });
      const s = await open();
      const quote = await s.quoteCapability(
        `host-health:${crypto.randomUUID()}`,
      );
      set({ kind: "confirm", quote, step: "capability" });
    } catch (e) {
      fail(e);
    }
  }
  async function confirm(
    quote: SelfPayFeeQuote,
    step: "capability" | "command",
  ) {
    const s = session.current!;
    let runId: string | undefined;
    try {
      if (step === "capability") {
        set({
          kind: "busy",
          step: t(
            "申请一次性健康检查授权",
            "Obtaining a one-use health capability",
          ),
        });
        const outcome = await s.submit(quote);
        if (outcome.status !== "confirmed")
          throw new HostHealthError("invalid_source");
        const capability = await s.capability(outcome);
        set({
          kind: "busy",
          step: t(
            "签名命令并准备执行记录",
            "Signing the command and preparing its Run",
          ),
        });
        const prepared = await s.quoteCommand(
          capability,
          `host-health:${crypto.randomUUID()}`,
        );
        command.current = prepared.command;
        if (
          BigInt(prepared.quote.estimatedGas) > AUTO_FEE_MIST ||
          BigInt(prepared.quote.simulatedSuiSpend) !== 0n
        )
          return set({
            kind: "confirm",
            quote: prepared.quote,
            step: "command",
          });
        quote = prepared.quote;
      }
      set({ kind: "busy", step: t("提交执行记录", "Submitting the Run") });
      const outcome = await s.submit(quote);
      if (outcome.status !== "confirmed")
        throw new HostHealthError("invalid_source");
      runId = await s.run(outcome, command.current!);
      set({ kind: "busy", step: t("发送到主机", "Sending to the Host") });
      await s.send(command.current!).catch(() => {
        // An unknown delivery is only followed by reading the original Run.
      });
      for (let i = 0; i < POLL_LIMIT; i++) {
        set({
          kind: "busy",
          step: t("等待主机回执", "Waiting for the Host's receipt"),
        });
        const result = await s.result(runId);
        if (result.state === "finished")
          return set({ kind: "done", result, runId });
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (!mounted.current) return;
      }
      throw new HostHealthError("delivery_unknown");
    } catch (e) {
      fail(e, runId);
    }
  }
  const ready = isTauri() && !!deviceProfile;
  const busy = phase.kind === "busy";
  return (
    <section className="card">
      <div className="card-h">
        <h2>{t("健康检查", "Health check")}</h2>
        {phase.kind === "done" && (
          <span className={`chip ${phase.result.ok ? "ok" : "danger"}`}>
            {phase.result.ok
              ? t("全部通过", "All passed")
              : t("有检查未通过", "Check failed")}
          </span>
        )}
      </div>
      <p className="small muted">
        {t(
          "在主机上运行它自己配置的只读检查（runtime.health_probes）。命令经授权、留回执；结果加密写在链上，只在本设备解密。",
          "Runs the read-only checks this Host configured (runtime.health_probes). The command is authorized and receipted; the result is encrypted on chain and decrypted only on this device.",
        )}
      </p>
      {phase.kind === "busy" && <p className="small">{phase.step}…</p>}
      {phase.kind === "confirm" && (
        <div className="panel">
          <p className="small">
            {phase.step === "capability"
              ? t(
                  `需要两笔交易：一次性授权与执行记录。第一笔费用约 ${phase.quote.estimatedGas} MIST，第二笔不超过 0.01 SUI 时自动提交。`,
                  `Two transactions: a one-use capability and the Run. The first costs about ${phase.quote.estimatedGas} MIST; the second is submitted automatically when it costs at most 0.01 SUI.`,
                )
              : t(
                  `执行记录费用约 ${phase.quote.estimatedGas} MIST。`,
                  `The Run costs about ${phase.quote.estimatedGas} MIST.`,
                )}
          </p>
          <div className="row gap">
            <button
              className="btn sm"
              onClick={() => void confirm(phase.quote, phase.step)}
            >
              {t("确认并运行", "Confirm & run")}
            </button>
            <button
              className="btn sm ghost"
              onClick={() => set({ kind: "idle" })}
            >
              {t("取消", "Cancel")}
            </button>
          </div>
        </div>
      )}
      {phase.kind === "done" && (
        <table className="tbl small">
          <thead>
            <tr>
              <th>{t("检查", "Check")}</th>
              <th>{t("结果", "Result")}</th>
              <th>{t("输出", "Output")}</th>
            </tr>
          </thead>
          <tbody>
            {phase.result.probes.map((p) => (
              <tr key={p.name}>
                <td className="mono">{p.name}</td>
                <td>
                  {p.ok
                    ? t("通过", "Passed")
                    : t(
                        `失败（退出码 ${p.exitCode}）`,
                        `Failed (exit ${p.exitCode})`,
                      )}{" "}
                  · {p.durationMs} ms
                </td>
                <td className="mono small">
                  {(p.stdout || p.stderr).slice(0, 400)}
                  {p.truncated ? " …" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {phase.kind === "error" && (
        <p className="warn small">
          {t("健康检查未完成", "Health check did not complete")}: {phase.code}
          {phase.runId && (
            <>
              {" · "}
              {t("执行记录", "Run")} <span className="mono">{phase.runId}</span>
            </>
          )}
        </p>
      )}
      <div className="card-f">
        <button
          className="btn sm"
          disabled={!ready || busy || phase.kind === "confirm"}
          onClick={() => void start()}
        >
          {t("运行健康检查", "Run health check")}
        </button>
      </div>
    </section>
  );
}
