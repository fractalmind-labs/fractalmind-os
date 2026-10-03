import {
  bytesToHex,
  directRequestHash,
  type DirectAction,
  type DirectRequest,
  type NetworkName,
} from "@fractalmind-labs/fractalmind-sdk";
import { modelReply, type NativeDirectAgent } from "./direct-agent";

/** An encrypted historical context snapshot, never an execution grant. */
export type MessageOkrSource = {
  schema: "fractalmind.okr-message-source.v1";
  network: NetworkName;
  chainIdentifier: string;
  organizationId: string;
  managedAgentId: string;
  managedVersion: string;
  membershipId: string;
  messageId: string;
  messageRecordId: string;
  permissionId: string;
  permissionVersion: string;
  authorHumanId: string;
  authorDevice: string;
  createdAtMs: string;
  action: DirectAction;
  requestHash: string;
  request: DirectRequest;
  reply?: {
    runId: string;
    recordId: string;
    verified: false;
    text: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  };
};
export class MessageOkrSourceError extends Error {
  constructor(readonly code: "invalid_source" | "source_changed") {
    super(code);
  }
}
const id = /^0x[0-9a-f]{64}$/;
const positive = (value: unknown) =>
  typeof value === "string" &&
  /^[1-9][0-9]{0,19}$/.test(value) &&
  BigInt(value) <= 0xffffffffffffffffn;
const canonical = (value: unknown) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export function normalizeMessageOkrSource(
  value: MessageOkrSource,
): MessageOkrSource {
  try {
    const source = structuredClone(value);
    if (
      source.schema !== "fractalmind.okr-message-source.v1" ||
      !["mainnet", "testnet", "devnet", "localnet"].includes(source.network) ||
      typeof source.chainIdentifier !== "string" ||
      !/^[A-Za-z0-9]{4,100}$/.test(source.chainIdentifier) ||
      ![
        source.organizationId,
        source.managedAgentId,
        source.membershipId,
        source.messageId,
        source.messageRecordId,
        source.permissionId,
        source.authorHumanId,
        source.authorDevice,
      ].every((v) => typeof v === "string" && id.test(v)) ||
      ![
        source.managedVersion,
        source.permissionVersion,
        source.createdAtMs,
      ].every(positive) ||
      !["ask", "status", "file.read", "file.write"].includes(source.action) ||
      bytesToHex(directRequestHash(source.request, source.action)) !==
        source.requestHash
    )
      throw new Error();
    const normalized: MessageOkrSource = {
      schema: source.schema,
      network: source.network,
      chainIdentifier: source.chainIdentifier,
      organizationId: source.organizationId,
      managedAgentId: source.managedAgentId,
      managedVersion: source.managedVersion,
      membershipId: source.membershipId,
      messageId: source.messageId,
      messageRecordId: source.messageRecordId,
      permissionId: source.permissionId,
      permissionVersion: source.permissionVersion,
      authorHumanId: source.authorHumanId,
      authorDevice: source.authorDevice,
      createdAtMs: source.createdAtMs,
      action: source.action,
      requestHash: source.requestHash,
      request: {
        message: source.request.message,
        ...(source.request.task === undefined
          ? {}
          : { task: source.request.task }),
        bounds: source.request.bounds,
      },
    };
    if (source.reply !== undefined) {
      const reply = source.reply;
      if (
        source.action !== "ask" ||
        !id.test(reply.runId) ||
        !id.test(reply.recordId) ||
        reply.verified !== false ||
        typeof reply.text !== "string" ||
        !reply.text ||
        typeof reply.model !== "string" ||
        !reply.model ||
        !Number.isSafeInteger(reply.inputTokens) ||
        reply.inputTokens < 0 ||
        !Number.isSafeInteger(reply.outputTokens) ||
        reply.outputTokens < 0
      )
        throw new Error();
      normalized.reply = {
        runId: reply.runId,
        recordId: reply.recordId,
        verified: false,
        text: reply.text,
        model: reply.model,
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
      };
    }
    if (
      canonical(normalized) !== canonical(source) ||
      new TextEncoder().encode(JSON.stringify(normalized)).length > 32768
    )
      throw new Error();
    return normalized;
  } catch {
    throw new MessageOkrSourceError("invalid_source");
  }
}

/** Reuse original message/record/hash and Host receipt verification. No quote,
 * signature, budget reservation or delivery is created by this read. */
export async function readMessageOkrSource(
  controller: NativeDirectAgent,
  messageId: string,
) {
  const chainIdentifier = await controller.chain.checkNetwork();
  const view = await controller.message(messageId),
    m = view.message;
  const source: MessageOkrSource = {
    schema: "fractalmind.okr-message-source.v1",
    network: controller.chain.profile.network,
    chainIdentifier,
    organizationId: m.org_id,
    managedAgentId: m.managed_agent,
    managedVersion: m.managed_version,
    membershipId: m.membership_id,
    messageId: m.id,
    messageRecordId: m.encrypted_record,
    permissionId: m.permission_id,
    permissionVersion: m.permission_version,
    authorHumanId: m.human_id,
    authorDevice: m.writer_device,
    createdAtMs: m.created_at_ms,
    action: m.action as DirectAction,
    requestHash: bytesToHex(Uint8Array.from(m.request_hash)),
    request: view.request,
  };
  const reply =
    m.action === "ask" &&
    view.result?.run.state === 2 &&
    view.result.response?.ok &&
    view.result.recordId
      ? modelReply(view.result.response.result)
      : null;
  if (reply)
    source.reply = {
      runId: view.result!.run.id,
      recordId: view.result!.recordId!,
      verified: false,
      ...reply,
    };
  if ((await controller.chain.checkNetwork()) !== chainIdentifier)
    throw new MessageOkrSourceError("source_changed");
  return normalizeMessageOkrSource(source);
}
export async function verifyMessageOkrSource(
  controller: NativeDirectAgent,
  raw: MessageOkrSource,
) {
  const expected = normalizeMessageOkrSource(raw);
  if (
    expected.organizationId !== controller.organizationId ||
    expected.managedAgentId !== controller.managedAgentId ||
    expected.network !== controller.chain.profile.network
  )
    throw new MessageOkrSourceError("invalid_source");
  const current = await readMessageOkrSource(controller, expected.messageId);
  // A later reply does not rewrite a snapshot taken before the response.
  if (!expected.reply) delete current.reply;
  if (canonical(current) !== canonical(expected))
    throw new MessageOkrSourceError("source_changed");
}
