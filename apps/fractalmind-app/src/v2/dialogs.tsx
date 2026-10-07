// App v2 (#75): flows any page can open — set up this computer as a host,
// create or import an Agent, connections / invitations / revocation. The
// flows themselves are the tested ones from the first App; v2 frames them in
// the prototype dialog.
import { createContext, lazy, Suspense, useContext, useState, type ReactNode } from "react";
import { useApp } from "./store";
import { Dialog, useT } from "./ui";

const LocalHostSetup = lazy(() => import("../LocalHostSetup"));
const AgentCreate = lazy(() => import("../AgentCreate"));
const AgentDiscover = lazy(() => import("../AgentDiscover"));
const HostAccess = lazy(() => import("../HostAccess"));
const CreateOkr = lazy(() => import("../CreateOkr"));

export type DialogSpec =
  | { kind: "host-setup" }
  | { kind: "agent-create" }
  | { kind: "agent-import"; session?: string | null }
  | { kind: "okr-create" }
  | { kind: "host-access"; operation: "binding" | "invite" | "revoke-member"; target?: string };
type Dialogs = { open: (spec: DialogSpec) => void };
const DialogContext = createContext<Dialogs>({ open: () => {} });
export const useDialogs = () => useContext(DialogContext);

export function DialogHost({ children }: { children: ReactNode }) {
  const app = useApp();
  const t = useT();
  const [spec, setSpec] = useState<DialogSpec | null>(null);
  // HostAccess keeps its own native dialog; each request bumps `n`.
  const [access, setAccess] = useState<{ kind: "binding" | "invite" | "revoke-member"; target?: string; n: number } | null>(
    null,
  );
  const close = () => setSpec(null);
  const open = (next: DialogSpec) => {
    if (next.kind === "host-access") setAccess((r) => ({ kind: next.operation, target: next.target, n: (r?.n ?? 0) + 1 }));
    else setSpec(next);
  };
  const snapshot = app.snapshot;
  const loading = <p className="small muted">{t("加载…", "Loading…")}</p>;
  let body: ReactNode = null;
  if (spec && snapshot && app.profile) {
    const organizationId = snapshot.organization.objectId;
    if (spec.kind === "host-setup")
      body = (
        <Dialog title={t("把这台电脑设为执行主机", "Use this computer as a host")} onClose={close}>
          {app.deviceProfile ? (
            <LocalHostSetup
              profile={app.profile}
              organizationId={organizationId}
              deviceProfile={app.deviceProfile}
              t={t}
              onDone={() => {
                close();
                app.refresh();
              }}
              onSkip={close}
            />
          ) : (
            <p className="small">{t("请先解锁本设备。", "Unlock this device first.")}</p>
          )}
        </Dialog>
      );
    else if (spec.kind === "agent-create")
      body = (
        <Dialog title={t("新建 Agent", "New Agent")} size="lg" onClose={close}>
          <AgentCreate t={t} onClose={close} onRegister={(session) => setSpec({ kind: "agent-import", session })} />
        </Dialog>
      );
    else if (spec.kind === "agent-import")
      body = (
        <Dialog
          title={t("导入主机上已运行的 Agent", "Import Agents running on a host")}
          sub={t(
            "勾选要导入的 Agent，一笔交易完成。agent-manager Agent 导入后可以接 OKR。",
            "Tick the Agents to import; one transaction. agent-manager Agents can take OKRs once imported.",
          )}
          size="lg"
          onClose={close}
        >
          <AgentDiscover
            profile={app.profile}
            organizationId={organizationId}
            deviceProfile={app.deviceProfile}
            memberships={snapshot.memberships.value ?? []}
            importedInstances={new Set((snapshot.agents.value ?? []).filter((a) => !a.revoked).map((a) => a.instance_id))}
            authorityRevision={app.hostAuthorityRevision}
            focusSession={spec.session ?? null}
            onChanged={app.refresh}
            t={t}
          />
        </Dialog>
      );
    else if (spec.kind === "okr-create")
      body = (
        <CreateOkr
          profile={app.profile}
          organizationId={organizationId}
          t={t}
          onCreated={() => {
            close();
            app.refresh();
          }}
          onClosed={close}
          autoOpen
        />
      );
  }
  return (
    <DialogContext.Provider value={{ open }}>
      {children}
      <Suspense fallback={spec ? loading : null}>
        {body}
        {snapshot && app.profile && (
          <HostAccess
            key={JSON.stringify([app.profile.humanId, snapshot.organization.objectId])}
            profile={app.profile}
            organizationId={snapshot.organization.objectId}
            t={t}
            onChanged={app.refresh}
            request={access}
          />
        )}
      </Suspense>
    </DialogContext.Provider>
  );
}
