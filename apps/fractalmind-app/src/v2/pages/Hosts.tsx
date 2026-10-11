// App v2 (#75): Hosts & compute — the #73 table and detail page, with the
// prototype header and its three entry buttons.
import { lazy, Suspense } from "react";
import { useApp } from "../store";
import { go, type Route } from "../router";
import { useDialogs } from "../dialogs";
import { Btn, useT } from "../ui";
import { okrTitle } from "../model";

const HostsPage = lazy(() => import("../../HostsPage"));

export default function Hosts({ route }: { route: Route }) {
  const app = useApp();
  const t = useT();
  const dialogs = useDialogs();
  const detail = route.parts[1] ?? null;
  if (!app.snapshot || !app.profile) return null;
  const manage = !!app.deviceProfile;
  return (
    <>
      {!detail && (
        <div className="page-h">
          <div>
            <h1>{t("主机与算力", "Hosts & compute")}</h1>
            <p className="muted">
              {t(
                "执行主机、Agent 实例和正在执行的 OKR。每台主机的心跳与连接相互独立。",
                "Execution hosts, Agent instances and the OKRs they run. Heartbeats and connections are independent per host.",
              )}
            </p>
          </div>
          <div className="row wrap">
            <Btn label={t("管理连接", "Connections")} icon="link" onClick={() => dialogs.open({ kind: "host-access", operation: "binding" })} />
            <Btn
              label={t("发现已有 Agent", "Discover Agents")}
              icon="scan"
              disabled={!manage}
              why={t("请先解锁本设备", "Unlock this device first")}
              onClick={() => dialogs.open({ kind: "agent-import" })}
            />
            <Btn
              label={t("接入主机", "Add a host")}
              icon="plus"
              kind="primary"
              onClick={() => dialogs.open({ kind: "host-access", operation: "invite" })}
            />
          </div>
        </div>
      )}
      <Suspense fallback={<p className="small muted">{t("加载主机…", "Loading Hosts…")}</p>}>
        <HostsPage
          key={JSON.stringify([app.profile.humanId, app.snapshot.organization.objectId])}
          profile={app.profile}
          snapshot={app.snapshot}
          deviceProfile={app.deviceProfile}
          authorityRevision={app.hostAuthorityRevision}
          detail={detail}
          onDetail={(address) => go(address ? `hosts/${address}` : "hosts")}
          onAccess={(operation, target) => dialogs.open({ kind: "host-access", operation, target })}
          onDiscover={() => dialogs.open({ kind: "agent-import" })}
          onOpenOkr={(id) => go(`okrs/${id}`)}
          okrTitle={(id) => okrTitle(app, id)}
          onChanged={app.refresh}
          t={t}
        />
      </Suspense>
    </>
  );
}
