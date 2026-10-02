import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, toBase64 } from "@mysten/sui/utils";
import { ChainReadSession } from "./chain";
import { DeviceIdentityVerifier } from "./device-identity";
import { hostDirectory, type HostBinding } from "./host-admission";
import { NativeDeviceSigner } from "./native-device";
import {
  verifySignedNodeCommand,
  type SignedNodeCommand,
} from "@fractalmind-labs/fractalmind-sdk";

export class CoordinatorReadError extends Error {
  constructor(
    readonly code:
      | "invalid_challenge"
      | "binding_changed"
      | "device_read_rejected"
      | "read_unavailable"
      | "read_already_used"
      | "invalid_command"
      | "command_outcome_unknown"
      | "invalid_observation",
  ) {
    super(code);
  }
}
const id = /^0x[0-9a-f]{64}$/;
type ReadRequest = {
  human_id: string;
  grant_id: string;
  device_address: string;
  organization_id: string;
  binding_id: string;
  method: "GET" | "POST";
  path: string;
  command_hash?: string;
  command_scope?: "observation" | "control";
};
type Challenge = ReadRequest & {
  chain_identifier: string;
  nonce: string;
  expires_at_ms: number;
  coordinator_public_key: string;
  signature: string;
};
function challengeText(c: Challenge) {
  if (c.method === "POST")
    return [
      "FM-COORDINATOR-COMMAND",
      "1",
      c.chain_identifier,
      c.organization_id,
      c.binding_id,
      c.human_id,
      c.grant_id,
      c.device_address,
      c.method,
      c.path,
      c.command_scope,
      c.command_hash,
      c.nonce,
      c.expires_at_ms,
    ].join(":");
  return [
    "FM-COORDINATOR-READ",
    "1",
    c.chain_identifier,
    c.organization_id,
    c.binding_id,
    c.human_id,
    c.grant_id,
    c.device_address,
    c.method,
    c.path,
    c.nonce,
    c.expires_at_ms,
  ].join(":");
}
function hex(value: string, length: number) {
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`).test(value))
    throw new CoordinatorReadError("invalid_challenge");
  return Uint8Array.from(value.match(/../g)!, (s) => parseInt(s, 16));
}
function permitted(path: string) {
  return (
    path === "/api/sentinels" ||
    path === "/api/health" ||
    /^\/api\/sentinels\/0x[0-9a-f]{64}(?:\/agents)?$/.test(path)
  );
}
function bindingPin(b: HostBinding) {
  return JSON.stringify([
    b.id,
    b.org_id,
    b.version,
    b.revoked,
    b.endpoint,
    b.coordinator_address,
    b.public_key,
  ]);
}
async function boundedJSON(response: Response) {
  if (!response.body) throw new CoordinatorReadError("read_unavailable");
  const reader = response.body.getReader();
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1 << 20) throw new CoordinatorReadError("invalid_observation");
      parts.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const raw = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    raw.set(part, offset);
    offset += part.length;
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(raw),
    ) as unknown;
  } catch {
    throw new CoordinatorReadError("invalid_observation");
  }
}

/** Native device transport. Read proofs cannot submit commands; command
 * proofs bind the exact signed envelope. Host independently authorizes every
 * command on Sui. No business cache, automatic dispatch or automatic replay. */
export class CoordinatorReadClient {
  readonly verifier: DeviceIdentityVerifier;
  constructor(
    readonly chain: ChainReadSession,
    readonly signer: NativeDeviceSigner,
    readonly grantId: string,
    readonly organizationId: string,
    readonly transport: typeof fetch = fetch,
  ) {
    if (!id.test(organizationId))
      throw new CoordinatorReadError("invalid_challenge");
    this.verifier = new DeviceIdentityVerifier(chain, signer, grantId);
  }
  private async binding(bindingId: string) {
    const directory = await hostDirectory(this.chain, this.organizationId);
    const binding = directory.bindings.find(
      (b) => b.id === bindingId && !b.revoked,
    );
    if (!binding) throw new CoordinatorReadError("binding_changed");
    return { binding, chainIdentifier: directory.chainIdentifier };
  }
  private async request(url: string, init: RequestInit) {
    try {
      return await this.transport(url, {
        ...init,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new CoordinatorReadError("read_unavailable");
    }
  }
  async prepare(bindingId: string, path = "/api/sentinels") {
    if (!id.test(bindingId) || !permitted(path))
      throw new CoordinatorReadError("invalid_challenge");
    return this.prepareRequest(bindingId, path);
  }
  /** Takes an already signed and chain-prepared command. Preparing this
   * transport sends no execution request. The caller explicitly invokes send
   * after user confirmation and checks the original Run for final results. */
  async prepareCommand(bindingId: string, command: SignedNodeCommand) {
    let snapshot: SignedNodeCommand;
    try {
      snapshot = JSON.parse(JSON.stringify(command));
      await verifySignedNodeCommand(snapshot);
    } catch {
      throw new CoordinatorReadError("invalid_command");
    }
    const read = [
      "inventory",
      "status",
      "monitor",
      "logs",
      "health",
      "availability",
    ].includes(snapshot.action);
    const control = ["start", "stop", "assign", "direct.message"].includes(
      snapshot.action,
    );
    if (
      !id.test(bindingId) ||
      snapshot.signer !== this.signer.device.address ||
      snapshot.target.organization_id !== this.organizationId ||
      !id.test(snapshot.target.node_id) ||
      !(
        (read && snapshot.scope === "observation") ||
        (control && snapshot.scope === "control")
      ) ||
      (control && !snapshot.target.agent_id) ||
      snapshot.expires_at_ms <= Date.now()
    )
      throw new CoordinatorReadError("invalid_command");
    const body = JSON.stringify({ node_command: snapshot });
    if (new TextEncoder().encode(body).length > 1 << 20)
      throw new CoordinatorReadError("invalid_command");
    const commandHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    return this.prepareRequest(
      bindingId,
      `/api/sentinels/${snapshot.target.node_id}/command`,
      {
        body,
        commandHash,
        scope: control ? "control" : "observation",
        expiresAtMs: snapshot.expires_at_ms,
      },
    );
  }
  private async prepareRequest(
    bindingId: string,
    path: string,
    command?: {
      body: string;
      commandHash: string;
      scope: "observation" | "control";
      expiresAtMs: number;
    },
  ) {
    const action = command?.scope === "control" ? "operate" : "read";
    await this.verifier.verifyOrganization(this.organizationId, action);
    const before = await this.binding(bindingId),
      b = before.binding;
    const request: ReadRequest = {
      human_id: this.chain.profile.humanId,
      grant_id: this.grantId,
      device_address: this.signer.device.address,
      organization_id: this.organizationId,
      binding_id: bindingId,
      method: command ? "POST" : "GET",
      path,
      ...(command
        ? { command_hash: command.commandHash, command_scope: command.scope }
        : {}),
    };
    const response = await this.request(b.endpoint + "/api/device-challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new CoordinatorReadError("device_read_rejected");
    const c = (await boundedJSON(response)) as Challenge;
    const now = Date.now(),
      publicHex = b.public_key
        .map((x) => x.toString(16).padStart(2, "0"))
        .join("");
    if (
      !c ||
      typeof c !== "object" ||
      Array.isArray(c) ||
      Object.entries(request).some(
        ([key, value]) => c[key as keyof Challenge] !== value,
      ) ||
      (!command &&
        (c.command_hash !== undefined || c.command_scope !== undefined)) ||
      c.chain_identifier !== before.chainIdentifier ||
      c.coordinator_public_key !== publicHex ||
      !Number.isSafeInteger(c.expires_at_ms) ||
      c.expires_at_ms <= now ||
      c.expires_at_ms - now > 120_000 ||
      typeof c.nonce !== "string" ||
      !/^[0-9a-f]{32}$/.test(c.nonce) ||
      typeof c.signature !== "string"
    )
      throw new CoordinatorReadError("invalid_challenge");
    const key = new Ed25519PublicKey(hex(publicHex, 32));
    if (
      key.toSuiAddress() !== b.coordinator_address ||
      !(await key.verify(
        new TextEncoder().encode(challengeText(c)),
        hex(c.signature, 64),
      ))
    )
      throw new CoordinatorReadError("invalid_challenge");
    if (bindingPin((await this.binding(bindingId)).binding) !== bindingPin(b))
      throw new CoordinatorReadError("binding_changed");
    const proof = await this.signer.proveDevice({
      chainIdentifier: c.chain_identifier,
      humanId: c.human_id,
      grantId: c.grant_id,
      nonce: c.nonce,
      expiresAtMs: c.expires_at_ms,
    });
    const authorization =
      "FractalMind " +
      btoa(JSON.stringify({ nonce: c.nonce, signature: proof.signature }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    let consumed = false;
    return Object.freeze({
      send: async () => {
        if (consumed) throw new CoordinatorReadError("read_already_used");
        consumed = true;
        if (Date.now() >= c.expires_at_ms)
          throw new CoordinatorReadError("invalid_challenge");
        if (command && Date.now() >= command.expiresAtMs)
          throw new CoordinatorReadError("invalid_command");
        // A device or binding can change after preparation while the UI waits
        // for explicit confirmation. Recheck before sending any execution.
        await this.verifier.verifyOrganization(this.organizationId, action);
        if (
          bindingPin((await this.binding(bindingId)).binding) !== bindingPin(b)
        )
          throw new CoordinatorReadError("binding_changed");
        if (
          Date.now() >= c.expires_at_ms ||
          (command && Date.now() >= command.expiresAtMs)
        )
          throw new CoordinatorReadError("invalid_challenge");
        try {
          const response = await this.request(b.endpoint + path, {
            method: request.method,
            headers: {
              Authorization: authorization,
              ...(command ? { "Content-Type": "application/json" } : {}),
            },
            ...(command ? { body: command.body } : {}),
          });
          if (!response.ok)
            throw new CoordinatorReadError("device_read_rejected");
          const envelope = (await boundedJSON(response)) as {
            nonce: string;
            body: string;
            signature: string;
          };
          if (
            !envelope ||
            typeof envelope !== "object" ||
            envelope.nonce !== c.nonce ||
            typeof envelope.body !== "string" ||
            envelope.body.length > 700_000 ||
            typeof envelope.signature !== "string"
          )
            throw new CoordinatorReadError("invalid_observation");
          let body: Uint8Array;
          try {
            body = fromBase64(envelope.body);
            if (toBase64(body) !== envelope.body || body.length > 512 * 1024)
              throw new Error();
          } catch {
            throw new CoordinatorReadError("invalid_observation");
          }
          const digest = new Uint8Array(
            await crypto.subtle.digest("SHA-256", new Uint8Array(body)),
          );
          const bodyHash = Array.from(digest, (b) =>
            b.toString(16).padStart(2, "0"),
          ).join("");
          const text = [
            "FM-COORDINATOR-RESPONSE",
            "1",
            c.chain_identifier,
            c.organization_id,
            c.binding_id,
            c.nonce,
            c.method,
            c.path,
            response.status,
            bodyHash,
          ].join(":");
          if (
            !(await key.verify(
              new TextEncoder().encode(text),
              hex(envelope.signature, 64),
            ))
          )
            throw new CoordinatorReadError("invalid_observation");
          let value: unknown;
          try {
            value = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(body),
            );
          } catch {
            throw new CoordinatorReadError("invalid_observation");
          }
          await this.verifier.verifyOrganization(this.organizationId, action);
          if (
            bindingPin((await this.binding(bindingId)).binding) !==
            bindingPin(b)
          )
            throw new CoordinatorReadError("binding_changed");
          return value;
        } catch (error) {
          // An HTTP error, lost response or revocation during execution is not
          // proof that nothing happened. Never resend: query the original Run.
          if (command)
            throw new CoordinatorReadError("command_outcome_unknown");
          throw error;
        }
      },
    });
  }
  async read(bindingId: string, path = "/api/sentinels") {
    return (await this.prepare(bindingId, path)).send();
  }
  async readHosts(bindingId: string) {
    const before = await this.binding(bindingId);
    const response = await this.read(bindingId);
    const { verifyHostObservations } = await import("./host-signatures");
    const observations = await verifyHostObservations(
      this.chain,
      this.organizationId,
      bindingId,
      response,
    );
    await this.verifier.verifyOrganization(this.organizationId, "read");
    if (
      bindingPin((await this.binding(bindingId)).binding) !==
      bindingPin(before.binding)
    )
      throw new CoordinatorReadError("binding_changed");
    return observations;
  }
}
