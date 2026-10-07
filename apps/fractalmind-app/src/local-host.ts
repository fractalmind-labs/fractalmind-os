import { invoke } from "@tauri-apps/api/core";
import type { SelfPayTransactionOutcome } from "@fractalmind-labs/fractalmind-sdk";
import type { ChainReadSession } from "./chain";
import type { ConnectionProfile } from "./domain";
import {
  HostAdmissionError,
  type HostAdmission,
  type HostBinding,
  type HostDirectory,
  type HostMember,
} from "./host-admission";

/** This computer as the organization's Host + Coordinator (#64). Native code
 * runs the bundled envd as a per-user background service; this module only
 * orders the chain steps. Keys stay with envd and the device vault; the
 * one-use invitation goes from memory to envd's stdin and is never stored. */
export type LocalHostPublic = {
  format: string;
  profile: string;
  host_address: string;
  signing_public_key: string;
  encryption_public_key: string;
};
export type LocalHostRecord = {
  network: string;
  organizationId: string;
  bindingId: string;
  hostName: string;
  port: number;
  endpoint: string;
};
export type ServiceState =
  | "not_installed"
  | "stopped"
  | "starting"
  | "running"
  | "unknown"
  | "unsupported";
export type LocalHostStatus = {
  supported: boolean;
  envdAvailable: boolean;
  configured: LocalHostRecord | null;
  service: ServiceState;
  pid: number | null;
  listening: boolean;
  /** False after an App update until the service is reinstalled. */
  serviceCurrent: boolean;
  configPath: string;
  logPath: string;
  workspacePath: string;
  defaultHostName: string;
  suggestedPort: number | null;
};
export type JoinResult = {
  state: "confirmed" | "failed" | "unknown" | "cancelled" | string;
  digest?: string;
  actual_fee_mist?: string;
  membership?: { membership_id?: string } & Record<string, unknown>;
  membership_reconstruction_pending?: boolean;
};
export type LocalHostChain = {
  network: string;
  rpcUrl: string;
  chainIdentifier: string;
  packageId: string;
  originalPackageId: string;
  okrPackageId: string;
  originalOkrPackageId: string;
  directPackageId: string;
  originalDirectPackageId: string;
  registryId: string;
};
type Invoke = <T>(command: string, args: Record<string, unknown>) => Promise<T>;

export class LocalHostError extends Error {
  constructor(
    readonly code:
      | "unsupported"
      | "envd_unavailable"
      | "network_mismatch"
      | "binding_failed"
      | "invite_failed"
      | "join_failed"
      | "join_unknown"
      | "join_cancelled"
      | "service_failed"
      | "native_failed",
    readonly detail?: string,
  ) {
    super(code);
  }
}
function nativeError(e: unknown): never {
  const text = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  if (text === "LocalHostUnsupported") throw new LocalHostError("unsupported");
  if (text === "EnvdUnavailable") throw new LocalHostError("envd_unavailable");
  if (text === "LocalHostNetworkMismatch")
    throw new LocalHostError("network_mismatch");
  if (text.startsWith("Service"))
    throw new LocalHostError("service_failed", text);
  throw new LocalHostError("native_failed", text.slice(0, 300));
}
export class LocalHostNative {
  constructor(private readonly call: Invoke = invoke) {}
  private async run<T>(command: string, args: Record<string, unknown>) {
    try {
      return await this.call<T>(command, args);
    } catch (e) {
      nativeError(e);
    }
  }
  status(profile: string) {
    return this.run<LocalHostStatus>("fm_local_host_status", { profile });
  }
  keys(profile: string, network: string) {
    return this.run<LocalHostPublic>("fm_local_host_keys", {
      profile,
      network,
    });
  }
  configure(
    profile: string,
    chain: LocalHostChain,
    organization: {
      organizationId: string;
      bindingId: string;
      hostName: string;
      port: number;
    },
  ) {
    return this.run<LocalHostRecord>("fm_local_host_configure", {
      profile,
      chain,
      organization,
    });
  }
  /** Without an invitation envd only reconciles its original attempt. */
  join(profile: string, invitation: string | null, newAttempt = false) {
    return this.run<JoinResult>("fm_local_host_join", {
      profile,
      invitation,
      newAttempt,
    });
  }
  service(profile: string, action: "install" | "start" | "stop") {
    return this.run<void>("fm_local_host_service", { profile, action });
  }
  uninstall(profile: string) {
    return this.run<void>("fm_local_host_uninstall", { profile });
  }
  /** This computer's running Agents, read directly (no coordinator, no keys). */
  discover(profile: string) {
    return this.run<{
      discovery: unknown;
      hostAddress: string | null;
      observedAtMs: number;
    }>("fm_local_host_discover", { profile });
  }
}

export const FIRST_PORT = 7443;
export const PORT_SPAN = 20;
/** Gas ceilings the generated envd config uses, and the Host's starting balance. */
export const JOIN_GAS_BUDGET = 30_000_000n;
export const RESULT_GAS_BUDGET = 50_000_000n;
export const HOST_FUNDING_MIST = 100_000_000n;
export const MEMBERSHIP_DAYS = 90;
export const OBSERVATION_HOURS = 24 * 30;

export function localEndpoint(port: number) {
  return `http://127.0.0.1:${port}`;
}
export function endpointPort(endpoint: string): number | null {
  const m = /^http:\/\/127\.0\.0\.1:(\d{4,5})$/.exec(endpoint);
  const port = m ? Number(m[1]) : NaN;
  return port >= FIRST_PORT && port < FIRST_PORT + PORT_SPAN ? port : null;
}
export function chainConfig(
  profile: ConnectionProfile,
  chainIdentifier: string,
): LocalHostChain {
  const original = profile.originalPackageId ?? profile.packageId;
  const okr = profile.okrPackageId ?? profile.packageId;
  const direct = profile.directPackageId ?? profile.packageId;
  return {
    network: profile.network,
    rpcUrl: profile.rpcUrl,
    chainIdentifier,
    packageId: profile.packageId,
    originalPackageId: original,
    okrPackageId: okr,
    originalOkrPackageId: profile.originalOkrPackageId ?? okr,
    directPackageId: direct,
    originalDirectPackageId: profile.originalDirectPackageId ?? direct,
    registryId: profile.registryId,
  };
}
const hex = (bytes: number[]) =>
  bytes.map((n) => n.toString(16).padStart(2, "0")).join("");

/** The binding this Host coordinates for: its own key on a loopback port. */
export function localBinding(
  directory: HostDirectory,
  keys: LocalHostPublic,
): HostBinding | null {
  return (
    directory.bindings.find(
      (b) =>
        !b.revoked &&
        hex(b.public_key) === keys.signing_public_key &&
        endpointPort(b.endpoint) !== null,
    ) ?? null
  );
}
export function localMembership(
  directory: HostDirectory,
  keys: LocalHostPublic,
  bindingId: string,
): HostMember | null {
  return (
    directory.memberships.find(
      (m) =>
        !m.revoked &&
        m.host_address === keys.host_address &&
        m.coordinator_binding === bindingId &&
        BigInt(m.expires_at_ms) > directory.clockMs,
    ) ?? null
  );
}
/** Funding is skipped when the Host already holds enough for its own Gas. */
export function fundingFor(balance: bigint) {
  return balance >= JOIN_GAS_BUDGET + RESULT_GAS_BUDGET
    ? 0n
    : HOST_FUNDING_MIST;
}

/** Correlation ids only; never the invitation or any key material. */
type Attempts = { binding: string; invite: string };
export type SetupPhase =
  "keys" | "binding" | "configure" | "invite" | "join" | "service" | "online";
export type SetupResult = {
  keys: LocalHostPublic;
  bindingId: string;
  membershipId: string;
  endpoint: string;
  fees: SelfPayTransactionOutcome[];
  joinFee?: string;
};
export type SetupContext = {
  native: LocalHostNative;
  chain: ChainReadSession;
  admission: HostAdmission;
  deviceProfile: string;
  organizationId: string;
  hostName: string;
  port: number;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  onPhase?: (phase: SetupPhase) => void;
  sleep?: (ms: number) => Promise<void>;
};
function attemptsKey(chain: ChainReadSession, organizationId: string) {
  const p = chain.profile;
  return `fractalmind.app.local-host-setup.v1:${JSON.stringify([p.network, p.chainIdentifier, p.humanId, organizationId])}`;
}
function readAttempts(ctx: SetupContext): Attempts {
  const key = attemptsKey(ctx.chain, ctx.organizationId);
  try {
    const v = JSON.parse(ctx.storage?.getItem(key) ?? "null");
    if (v && typeof v.binding === "string" && typeof v.invite === "string")
      return v;
  } catch {}
  const fresh = { binding: crypto.randomUUID(), invite: crypto.randomUUID() };
  ctx.storage?.setItem(key, JSON.stringify(fresh));
  return fresh;
}
function saveAttempts(ctx: SetupContext, value: Attempts) {
  ctx.storage?.setItem(
    attemptsKey(ctx.chain, ctx.organizationId),
    JSON.stringify(value),
  );
}

/** One confirmed transaction per step, resumable at every point. A step whose
 * original transaction is known is reconciled, never broadcast again; a known
 * failure stops and needs the person's explicit retry. */
export async function setupLocalHost(
  ctx: SetupContext,
  options: { retryFailed?: boolean } = {},
): Promise<SetupResult> {
  const sleep = ctx.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const network = ctx.chain.profile.network;
  const attempts = readAttempts(ctx);
  const fees: SelfPayTransactionOutcome[] = [];
  ctx.onPhase?.("keys");
  const keys = await ctx.native.keys(ctx.deviceProfile, network);
  let directory = await ctx.admission.directory();

  // 1. Coordinator binding to this Host's key on a loopback port.
  ctx.onPhase?.("binding");
  let binding = localBinding(directory, keys);
  if (!binding) {
    let outcome = await submitStep(ctx, attempts.binding, {
      kind: "binding",
      endpoint: localEndpoint(ctx.port),
      publicKey: keys.signing_public_key,
    });
    if (outcome.status === "failed" && options.retryFailed) {
      attempts.binding = crypto.randomUUID();
      saveAttempts(ctx, attempts);
      outcome = await submitStep(ctx, attempts.binding, {
        kind: "binding",
        endpoint: localEndpoint(ctx.port),
        publicKey: keys.signing_public_key,
      });
    }
    if (outcome.status !== "confirmed")
      throw new LocalHostError("binding_failed", outcome.digest);
    fees.push(outcome);
    if (!(await ctx.admission.awaitVisible(outcome)))
      throw new HostAdmissionError("sync_pending");
    directory = await ctx.admission.directory();
    binding = localBinding(directory, keys);
    if (!binding) throw new HostAdmissionError("sync_pending");
  }
  const port = endpointPort(binding.endpoint)!;

  // 2. Public envd configuration pinned to that binding.
  ctx.onPhase?.("configure");
  await ctx.native.configure(
    ctx.deviceProfile,
    chainConfig(ctx.chain.profile, directory.chainIdentifier),
    {
      organizationId: ctx.organizationId,
      bindingId: binding.id,
      hostName: ctx.hostName,
      port,
    },
  );

  // 3. Membership: reconcile envd's original join before any new invitation.
  let member = localMembership(directory, keys, binding.id);
  let joinFee: string | undefined;
  if (!member) {
    ctx.onPhase?.("invite");
    const prior = await ctx.native
      .join(ctx.deviceProfile, null)
      .catch(() => null);
    if (prior?.state === "unknown")
      throw new LocalHostError("join_unknown", prior.digest);
    if (prior?.state === "confirmed") joinFee = prior.actual_fee_mist;
    directory = await ctx.admission.directory();
    member = localMembership(directory, keys, binding.id);
    const retryJoin = prior?.state === "failed";
    if (!member) {
      ctx.onPhase?.("invite");
      const balance = BigInt(
        (
          await ctx.chain.sdk.client.client.core.getBalance({
            owner: keys.host_address,
          })
        ).balance.balance,
      );
      const fund = fundingFor(balance);
      const invite = async () =>
        submitStep(ctx, attempts.invite, {
          kind: "invite",
          bindingId: binding!.id,
          ttlMinutes: 15,
          membershipDays: MEMBERSHIP_DAYS,
          observationHours: OBSERVATION_HOURS,
          ...(fund
            ? { fund: { address: keys.host_address, mist: fund.toString() } }
            : {}),
        });
      let outcome = await invite();
      let created =
        outcome.status === "confirmed"
          ? await ctx.admission.createdInvite(outcome)
          : null;
      // A used, expired or (after a restart) unknown code needs a new
      // invitation. Its original transaction stays in the journal.
      if (
        (outcome.status === "failed" && options.retryFailed) ||
        (created && !created.code)
      ) {
        attempts.invite = crypto.randomUUID();
        saveAttempts(ctx, attempts);
        outcome = await invite();
        created =
          outcome.status === "confirmed"
            ? await ctx.admission.createdInvite(outcome)
            : null;
      }
      if (!created?.code)
        throw new LocalHostError("invite_failed", outcome.digest);
      fees.push(outcome);
      ctx.onPhase?.("join");
      // The Host selects Gas from its own balance; wait until the funding
      // is visible to the RPC rather than let envd fail gas selection.
      for (let i = 0; fund && i < 60; i++) {
        const visible = BigInt(
          (
            await ctx.chain.sdk.client.client.core.getBalance({
              owner: keys.host_address,
            })
          ).balance.balance,
        );
        if (visible >= JOIN_GAS_BUDGET) break;
        await sleep(500);
      }
      let code: string | null = created.code;
      let result: JoinResult;
      try {
        result = await ctx.native.join(ctx.deviceProfile, code, retryJoin);
      } finally {
        code = null;
      }
      if (result.state === "cancelled")
        throw new LocalHostError("join_cancelled");
      if (result.state === "unknown")
        throw new LocalHostError("join_unknown", result.digest);
      if (result.state !== "confirmed")
        throw new LocalHostError("join_failed", result.digest);
      joinFee = result.actual_fee_mist;
      // The next setup must not reuse a consumed invitation attempt.
      attempts.invite = crypto.randomUUID();
      saveAttempts(ctx, attempts);
      for (let i = 0; i < 40 && !member; i++) {
        directory = await ctx.admission.directory();
        member = localMembership(directory, keys, binding.id);
        if (!member) await sleep(500);
      }
      if (!member) throw new HostAdmissionError("sync_pending");
    }
  }

  // 4. Background service, then wait for the Coordinator port.
  ctx.onPhase?.("service");
  await ctx.native.service(ctx.deviceProfile, "install");
  ctx.onPhase?.("online");
  for (let i = 0; i < 60; i++) {
    const status = await ctx.native.status(ctx.deviceProfile);
    if (status.service === "running" && status.listening) break;
    if (i === 59) throw new LocalHostError("service_failed", status.service);
    await sleep(500);
  }
  return {
    keys,
    bindingId: binding.id,
    membershipId: member.id,
    endpoint: binding.endpoint,
    fees,
    joinFee,
  };
}
async function submitStep(
  ctx: SetupContext,
  attemptId: string,
  operation: Parameters<HostAdmission["prepare"]>[0],
): Promise<SelfPayTransactionOutcome> {
  const result = await ctx.admission.prepare(operation, attemptId, true);
  if ("status" in result) return result;
  return ctx.admission.submit(result);
}

/** Desktop Apps only; phones never act as Hosts. */
export function canHostLocally(userAgent = navigator.userAgent) {
  return !/Android|iPhone|iPad|iPod/i.test(userAgent);
}
