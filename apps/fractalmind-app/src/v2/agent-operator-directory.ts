import { useCallback, useEffect, useState } from "react";
import { ChainReadSession } from "../chain";
import { readAgentOperatorDirectory, type AgentOperatorDirectory } from "../agent-operator-chain";
import { useApp } from "./store";

export type AgentOperatorDirectoryState =
  | { kind: "loading" }
  | { kind: "ready"; directory: AgentOperatorDirectory }
  | { kind: "error" };

/** Read-only directory hook shared by the page and its navigation badge. */
export function useAgentOperatorDirectory() {
  const app = useApp();
  const [state, setState] = useState<AgentOperatorDirectoryState>({ kind: "loading" });
  const [sequence, setSequence] = useState(0);
  const profileKey = app.profile ? JSON.stringify([app.profile.network, app.profile.rpcUrl, app.profile.packageId, app.profile.registryId, app.profile.humanId, app.organizationId]) : "";
  const refresh = useCallback(() => setSequence((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    if (!app.profile || !app.organizationId || app.profile.network !== "localnet") {
      setState({ kind: "ready", directory: { nowMs: BigInt(app.wallMs), pending: [], active: [], inactive: [] } });
      return () => { live = false; };
    }
    setState({ kind: "loading" });
    void readAgentOperatorDirectory(new ChainReadSession(app.profile), app.organizationId).then(
      (directory) => { if (live) setState({ kind: "ready", directory }); },
      () => { if (live) setState({ kind: "error" }); },
    );
    return () => { live = false; };
  // A connection/scope change cannot display a prior organization's rows.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileKey, sequence]);
  return { state, refresh };
}
