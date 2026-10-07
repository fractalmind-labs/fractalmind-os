// App v2 (#75): root. Same gating as the first App — no connection or device
// keys show the welcome flow, a locked session shows the lock screen — then
// the prototype shell with the routed page.
import { lazy, Suspense } from "react";
import { isTauri } from "@tauri-apps/api/core";
import Welcome from "../Welcome";
import { deviceConnection } from "../native-device";
import { matchesTarget } from "../build-target";
import { AppProvider, useApp } from "./store";
import { useRoute } from "./router";
import { DialogHost } from "./dialogs";
import { LockScreen, Shell } from "./Shell";
import { Icon, LogoDefs, useT } from "./ui";
import Workbench from "./pages/Workbench";

const Okrs = lazy(() => import("./pages/Okrs"));
const Hosts = lazy(() => import("./pages/Hosts"));
const Agents = lazy(() => import("./pages/Agents"));
const Other = lazy(() => import("./pages/Other").then((m) => ({ default: m.Memory })));
const Governance = lazy(() => import("./pages/Other").then((m) => ({ default: m.Governance })));
const Identity = lazy(() => import("./pages/Other").then((m) => ({ default: m.Identity })));
const Settings = lazy(() => import("./pages/Other").then((m) => ({ default: m.Settings })));
const Orgs = lazy(() => import("./pages/Other").then((m) => ({ default: m.Orgs })));
const Network = lazy(() => import("./pages/Other").then((m) => ({ default: m.Network })));

function Appearance() {
  const app = useApp();
  const t = useT();
  const next = { system: "light", light: "dark", dark: "system" } as const;
  return (
    <>
      <button
        className="tb-btn lang"
        aria-label={t("切换语言", "Switch language")}
        onClick={() => app.setPrefs({ ...app.prefs, language: app.prefs.language === "zh" ? "en" : "zh" })}
      >
        {app.prefs.language === "zh" ? "EN" : "中"}
      </button>
      <button className="tb-btn" aria-label={t("外观", "Appearance")} onClick={() => app.setPrefs({ ...app.prefs, theme: next[app.prefs.theme] })}>
        <Icon name={{ system: "monitor", light: "sun", dark: "moon" }[app.prefs.theme]} />
      </button>
    </>
  );
}

function Root() {
  const app = useApp();
  const t = useT();
  const route = useRoute();
  // A native App only opens organization views for the identity this device
  // was set up, paired or recovered for.
  const linked = !isTauri() || (deviceConnection()?.humanId === app.profile?.humanId && matchesTarget(app.profile));
  if (!app.profile || app.device.session.state === "no_device" || !linked)
    return <Welcome t={t} appearance={<Appearance />} connect={app.connect} newDevice={isTauri()} />;
  const s = app.device.session.state;
  if (s === "checking" || s === "unlocking" || s === "locked") return <LockScreen />;
  const page = {
    workbench: <Workbench />,
    okrs: <Okrs route={route} />,
    hosts: <Hosts route={route} />,
    agents: <Agents />,
    memory: <Other />,
    governance: <Governance />,
    identity: <Identity />,
    settings: <Settings />,
    orgs: <Orgs />,
    network: <Network />,
  }[route.name];
  return (
    <DialogHost>
      <Shell route={route} wide={route.name === "workbench" || route.name === "hosts"}>
        <Suspense fallback={<p className="small muted">{t("加载…", "Loading…")}</p>}>{page}</Suspense>
      </Shell>
    </DialogHost>
  );
}

export function App() {
  return (
    <>
      <LogoDefs />
      <AppProvider>{() => <Root />}</AppProvider>
    </>
  );
}
