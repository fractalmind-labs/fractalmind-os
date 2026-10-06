import { PRODUCT_RECORD_KINDS } from "@fractalmind-labs/fractalmind-sdk";
import type { ChainReadSession } from "./chain";
import type { PrivateRecords } from "./private-records";

/** Readable OKR text from its encrypted spec record. Memory only. */
export type OkrText = Readonly<{ objective: string; krTitles: string[] }>;

export class OkrTextError extends Error {
  constructor(readonly code: "invalid_spec" | "invalid_source") {
    super(code);
  }
}

/** Parses a decrypted `fractalmind.okr-spec.v1` body down to its display text. */
export function parseOkrSpec(plaintext: Uint8Array): OkrText {
  let spec: unknown;
  try {
    spec = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
  } catch {
    throw new OkrTextError("invalid_spec");
  }
  const v = spec as Record<string, unknown> | null;
  if (
    !v ||
    typeof v !== "object" ||
    v.schema !== "fractalmind.okr-spec.v1" ||
    typeof v.objective !== "string" ||
    !v.objective.trim() ||
    v.objective.length > 512 ||
    !Array.isArray(v.krs) ||
    v.krs.length < 1 ||
    v.krs.length > 3
  )
    throw new OkrTextError("invalid_spec");
  const krTitles = v.krs.map((kr) => {
    const title = (kr as Record<string, unknown> | null)?.title;
    if (typeof title !== "string" || title.length > 256)
      throw new OkrTextError("invalid_spec");
    return title;
  });
  return Object.freeze({ objective: v.objective, krTitles });
}

/** The spec record logical ID written when the OKR draft was created. */
export const okrSpecLogicalId = (logicalId: string) => `okr-${logicalId}-spec`;

/** Decrypts the spec record an OKR points to. Each read re-verifies this device,
 * the organization and the record chain (PrivateRecords). */
export async function readOkrText(
  chain: ChainReadSession,
  records: PrivateRecords,
  organizationId: string,
  okr: { logical_id: string; spec_record: string },
): Promise<OkrText> {
  const logicalId = okrSpecLogicalId(okr.logical_id);
  const record = await chain.sdk.productRecord.getRecord(okr.spec_record);
  if (
    record.organization_id !== organizationId ||
    record.kind !== PRODUCT_RECORD_KINDS.okr ||
    record.logical_id !== logicalId
  )
    throw new OkrTextError("invalid_source");
  const plaintext = await records.read(
    {
      kind: PRODUCT_RECORD_KINDS.okr,
      logicalId,
      record_id: record.id,
      revision: record.revision,
      key_version: record.key_version,
    },
    true,
  );
  try {
    return parseOkrSpec(plaintext);
  } finally {
    plaintext.fill(0);
  }
}
