import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChainReadSession } from "./chain";
import type { DeviceSession } from "./device-session";
import type { ConnectionProfile, Grant, OkrSnapshot } from "./domain";
import { NativeDeviceSigner, type NativeInvoke } from "./native-device";
import { readOkrText, type OkrText } from "./okr-text";
import { PrivateRecords } from "./private-records";

const transport: NativeInvoke = (command, args) => invoke(command, args);

/** This device's active grant for an organization, matched by device address. */
export function deviceGrant(
  grants: Grant[] | null | undefined,
  address: string,
  organizationId: string,
) {
  return grants?.find(
    (g) =>
      g.device === address &&
      !g.revoked &&
      (g.org_scope === null || g.org_scope === organizationId),
  );
}

/** Decrypted OKR titles while the device session is unlocked. Plaintext lives
 * in memory only and is dropped as soon as the session is no longer unlocked. */
export function useOkrTexts(
  session: DeviceSession,
  profile: ConnectionProfile | null,
  organizationId: string | undefined,
  okrs: OkrSnapshot[] | null | undefined,
  grants: Grant[] | null | undefined,
) {
  const [texts, setTexts] = useState<ReadonlyMap<string, OkrText>>(new Map());
  const cache = useRef(new Map<string, OkrText | null>());
  const address = session.state === "unlocked" ? session.device.address : null;
  const deviceProfile = session.state === "unlocked" ? session.profile : null;
  const grantId =
    address && organizationId
      ? deviceGrant(grants, address, organizationId)?.id
      : undefined;
  const wanted = (okrs ?? [])
    .filter((row) => row.okr.spec_record)
    .map((row) => `${row.okr.id}:${row.okr.spec_record}`)
    .join(",");

  useEffect(() => {
    if (!address || !deviceProfile || !grantId || !profile || !organizationId) {
      cache.current.clear();
      setTexts(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const pending = (okrs ?? []).filter(
        (row) =>
          row.okr.spec_record &&
          !cache.current.has(`${row.okr.id}:${row.okr.spec_record}`),
      );
      if (!pending.length) return;
      const chain = new ChainReadSession(profile);
      const signer = await NativeDeviceSigner.load(transport, deviceProfile);
      const records = new PrivateRecords(
        chain,
        signer,
        grantId,
        organizationId,
        transport,
      );
      for (const row of pending) {
        if (cancelled) return;
        const key = `${row.okr.id}:${row.okr.spec_record}`;
        try {
          cache.current.set(
            key,
            await readOkrText(chain, records, organizationId, row.okr),
          );
        } catch {
          // Keep the encrypted fallback for this record in this session.
          cache.current.set(key, null);
        }
        if (cancelled) return;
        setTexts(
          new Map(
            [...cache.current].flatMap(([k, v]) =>
              v ? [[k.split(":")[0], v] as const] : [],
            ),
          ),
        );
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // `wanted` captures the OKR and spec-record identities.
  }, [address, deviceProfile, grantId, profile, organizationId, wanted]);

  return texts;
}
