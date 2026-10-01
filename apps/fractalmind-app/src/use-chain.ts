import { useEffect, useMemo, useState } from "react";
import { ChainReadSession } from "./chain";
import type { ConnectionProfile, OrganizationSnapshot } from "./domain";

type Identity = Awaited<ReturnType<ChainReadSession["human"]>>;
export function useChain(profile: ConnectionProfile | null) {
  const session = useMemo(
    () => (profile ? new ChainReadSession(profile) : null),
    [profile],
  );
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [organizationId, setOrganizationId] = useState("");
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null);
  const [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [reachable, setReachable] = useState(false);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [bootSequence, setBootSequence] = useState(0);
  const hasIdentity = identity !== null;
  useEffect(() => {
    let live = true;
    setIdentity(null);
    setSnapshot(null);
    setOrganizationId("");
    setError(false);
    setReachable(false);
    if (!session) return;
    setBusy(true);
    session
      .human()
      .then(
        (value) => {
          if (live) {
            setIdentity(value);
            setOrganizationId(value.organizations[0]?.objectId ?? "");
            setReachable(true);
          }
        },
        () => {
          if (live) setError(true);
        },
      )
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [session, bootSequence]);
  useEffect(() => {
    let live = true,
      loading = false;
    setSnapshot((previous) =>
      previous?.organization.objectId === organizationId ? previous : null,
    );
    setError(false);
    setReachable(false);
    if (!session || !organizationId || !hasIdentity) return;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      setBusy(true);
      try {
        // Refresh Human generation, organizations and device grants together
        // with the organization. A cached grant is never current authority.
        const root = await session.human();
        if (!live) return;
        setIdentity(root);
        if (
          !root.organizations.some((org) => org.objectId === organizationId)
        ) {
          setSnapshot(null);
          setOrganizationId(root.organizations[0]?.objectId ?? "");
          setReachable(true);
          setError(false);
          return;
        }
        const result = await session.loadOrganization(organizationId);
        if (live) {
          setSnapshot(result);
          setError(false);
          setReachable(true);
        }
      } catch {
        if (live) {
          setError(true);
          setReachable(false);
        }
      } finally {
        loading = false;
        if (live) setBusy(false);
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 15000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [session, organizationId, hasIdentity, refreshSequence]);
  // Changing organization must never display the previous organization's
  // contents under a new header, even before the effect cleanup runs.
  const scoped =
    snapshot?.organization.objectId === organizationId ? snapshot : null;
  return {
    session,
    identity,
    organizationId,
    selectOrganization: setOrganizationId,
    snapshot: scoped,
    error,
    busy,
    reachable,
    refresh: () => {
      if (!identity || !organizationId) setBootSequence((value) => value + 1);
      else setRefreshSequence((value) => value + 1);
    },
  };
}
