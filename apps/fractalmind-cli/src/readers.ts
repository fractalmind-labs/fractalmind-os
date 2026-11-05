import { createHash } from 'node:crypto';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { PRODUCT_RECORD_KINDS, type DeviceAction } from '@fractalmind-labs/fractalmind-sdk';
import { authorize, readableActions, type Authorization } from './auth.js';
import { EXIT, FmError } from './output.js';
import { readCache, writeCache } from './storage.js';

const objectId = /^0x[0-9a-fA-F]+$/;
const cacheKey = (parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex');
const same = (left: string, right: string) => normalizeSuiAddress(left) === normalizeSuiAddress(right);

function id(value: string | undefined, noun: string) {
  if (!value || !objectId.test(value)) throw new FmError(EXIT.usage, 'usage', `${noun} must be a Sui object id.`);
  return normalizeSuiAddress(value);
}

function missing(error: unknown) {
  return !!error && typeof error === 'object' && 'reason' in error && error.reason === 'notFound';
}

function notFound(error: unknown, noun: string): never {
  if (missing(error) || (error instanceof Error && /not found|not a Move object/i.test(error.message)))
    throw new FmError(EXIT.not_found, 'not_found', `${noun} was not found.`);
  throw error;
}

function unavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|unavailable|network/i.test(message);
}

/** Authorization is always before the cache.  A cache can smooth an object
 * read that races an otherwise healthy node, but cannot resurrect a revoked
 * grant or mask a chain outage during authorization. */
export async function readAuthorized<T>(network: string, key: string, fn: (auth: Authorization) => Promise<T>, required: DeviceAction = 'read') {
  const auth = await authorize(network, required);
  try {
    const value = await fn(auth);
    await writeCache(network, cacheKey([auth.profile.organizationId, key]), value);
    return value;
  } catch (error) {
    if (error instanceof FmError || !unavailable(error)) throw error;
    const cached = await readCache<T>(network, cacheKey([auth.profile.organizationId, key]));
    if (cached) return { ...cached.value as object, stale_since: cached.stale_since } as T & { stale_since: string };
    throw error;
  }
}

export async function whoami(network: string) {
  return readAuthorized(network, 'whoami', async ({ profile, grant, operator, human }) => ({
    address: profile.address, humanId: human.id, organizationId: profile.organizationId, grantId: grant.id,
    actions: readableActions(grant.actions), expiresAtMs: grant.expires_at_ms, label: operator.label,
  }));
}

export async function orgShow(network: string) {
  return readAuthorized(network, 'org:show', async ({ sdk, profile }) => sdk.organization.getOrganization(profile.organizationId));
}

async function everyPage<Entry>(read: (cursor: string | null) => Promise<{ cursor: string | null; hasNextPage: boolean; values: Entry[] }>): Promise<Entry[]> {
  const results: Entry[] = []; let cursor: string | null = null;
  do {
    const page = await read(cursor);
    results.push(...page.values);
    cursor = page.hasNextPage ? page.cursor : null;
  } while (cursor);
  return results;
}

export async function okrList(network: string) {
  return readAuthorized(network, 'okr:list', async ({ sdk, profile }) => {
    try {
      return await everyPage(async cursor => {
        const page = await sdk.okr.listOkrs(profile.organizationId, cursor, 50);
        return { ...page, values: page.okrs };
      });
    } catch (error) {
      if (sdk.okr.isMissingIndex(error, profile.organizationId)) return [];
      throw error;
    }
  });
}

export async function okrShow(network: string, value: string | undefined) {
  const okrId = id(value, 'OKR id');
  return readAuthorized(network, `okr:show:${okrId}`, async ({ sdk, profile }) => {
    let okr;
    try { okr = await sdk.okr.getOkr(okrId); } catch (error) { notFound(error, 'OKR'); }
    if (!same(okr.org_id, profile.organizationId)) throw new FmError(EXIT.not_found, 'not_found', 'OKR belongs to another organization.');
    return okr;
  });
}

export async function hostList(network: string) {
  return readAuthorized(network, 'host:list', async ({ sdk, profile }) => {
    try {
      const index = await sdk.host.getIndex(profile.organizationId);
      return Promise.all(index.memberships.map(membershipId => sdk.host.getMembership(membershipId)));
    } catch (error) { if (missing(error)) return []; throw error; }
  });
}

export async function hostShow(network: string, value: string | undefined) {
  const membershipId = id(value, 'Host membership id');
  return readAuthorized(network, `host:show:${membershipId}`, async ({ sdk, profile }) => {
    let membership;
    try { membership = await sdk.host.getMembership(membershipId); } catch (error) { notFound(error, 'Host'); }
    if (!same(membership.org_id, profile.organizationId)) throw new FmError(EXIT.not_found, 'not_found', 'Host belongs to another organization.');
    return membership;
  });
}

export async function agentList(network: string) {
  return readAuthorized(network, 'agent:list', async ({ sdk, profile }) => {
    try { return everyPage(async cursor => {
      const page = await sdk.host.listManagedAgents(profile.organizationId, cursor, 50);
      return { ...page, values: page.agents };
    }); }
    catch (error) { if (missing(error)) return []; throw error; }
  });
}

export async function agentShow(network: string, value: string | undefined) {
  const agentId = id(value, 'Agent id');
  return readAuthorized(network, `agent:show:${agentId}`, async ({ sdk, profile }) => {
    let agent;
    try { agent = await sdk.host.getManagedAgent(agentId); } catch (error) { notFound(error, 'Agent'); }
    if (!same(agent.org_id, profile.organizationId)) throw new FmError(EXIT.not_found, 'not_found', 'Agent belongs to another organization.');
    return agent;
  });
}

export async function runList(network: string) {
  return readAuthorized(network, 'run:list', async ({ sdk, profile }) => {
    let okrs: Awaited<ReturnType<typeof sdk.okr.listOkrs>>['okrs'];
    try {
      okrs = await everyPage(async cursor => {
        const page = await sdk.okr.listOkrs(profile.organizationId, cursor, 50);
        return { ...page, values: page.okrs };
      });
    } catch (error) {
      if (sdk.okr.isMissingIndex(error, profile.organizationId)) return [];
      throw error;
    }
    const pages = await Promise.all(okrs.map(okr => everyPage(async cursor => {
      const page = await sdk.okr.listExecutions(okr.id, cursor, 50);
      return { ...page, values: page.executions };
    })));
    return pages.flat().map(item => item.run);
  });
}

export async function runShow(network: string, value: string | undefined) {
  const runId = id(value, 'Run id');
  return readAuthorized(network, `run:show:${runId}`, async ({ sdk, profile }) => {
    let run;
    try { run = await sdk.nodeExecution.getExecution(runId); } catch (error) { notFound(error, 'Run'); }
    if (!same(run.org_id, profile.organizationId)) throw new FmError(EXIT.not_found, 'not_found', 'Run belongs to another organization.');
    return run;
  });
}

export async function approvalList(network: string) {
  return readAuthorized(network, 'approval:list', async ({ sdk, profile }) => {
    try {
      const records = await everyPage(async cursor => {
        const page = await sdk.productRecord.listCurrent(profile.organizationId, cursor, 50);
        return { ...page, values: page.records };
      });
      return records.filter(record => record.kind === PRODUCT_RECORD_KINDS.approval);
    } catch (error) { if (missing(error)) return []; throw error; }
  });
}

export async function eventPage(network: string, cursor?: string | null) {
  return readAuthorized(network, `events:${cursor ?? ''}`, async ({ sdk, profile }) => {
    const core = sdk.client.client.core as unknown as { listEvents(input: unknown): Promise<{ events: unknown[]; cursor: string | null; hasNextPage: boolean }> };
    const page = await core.listEvents({ cursor: cursor ?? null, limit: 50 });
    const organizationId = profile.organizationId.toLowerCase();
    return {
      events: page.events.filter(event => JSON.stringify(event).toLowerCase().includes(organizationId)),
      cursor: page.cursor, hasNextPage: page.hasNextPage,
    };
  });
}

export const schema = {
  name: 'fm', version: 1,
  commands: {
    auth: ['login --org <name|id> [--network localnet|testnet] [--label <name>] [--faucet] [--no-wait]', 'status', 'logout'],
    read: ['whoami', 'org show', 'okr list|show <id>', 'host list|show <id>', 'agent list|show <id>', 'run list|show <id>', 'approval list', 'events --follow'],
    utility: ['schema'],
  },
  exits: { 0: 'ok', 2: 'usage', 3: 'needs_funding', 4: 'not_authorized', 5: 'revoked_or_expired', 6: 'chain_unreachable', 7: 'not_found' },
  rules: ['All read commands recheck an on-chain READ Agent Operator grant.', 'Approvals are always performed by a human in the App.', 'No command in this release sends an operational transaction except auth login.'],
};
