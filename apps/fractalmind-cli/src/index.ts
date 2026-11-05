#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { login, logout, status } from './auth.js';
import { EXIT, emitError, FmError, render } from './output.js';
import { approvalList, approvalShow, agentList, agentShow, eventPage, hostList, hostShow, okrList, okrShow, orgShow, runList, runShow, schema, whoami } from './readers.js';
import { loadDeployment } from './storage.js';
import type { ParsedArgs } from './types.js';
import { approvalRequired, createOkrDraft, messageAgent, pauseRun, requestApproval, updateOkrDraft, type WriteOptions } from './writers.js';

export function parse(argv: string[]): ParsedArgs {
  const command: string[] = [], values: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index]!;
    if (!value.startsWith('--')) { command.push(value); continue; }
    const [flag, inline] = value.slice(2).split('=', 2);
    if (!flag) throw new FmError(EXIT.usage, 'usage', 'Invalid empty option.');
    if (inline !== undefined) values[flag] = inline;
    else if (argv[index + 1] && !argv[index + 1]!.startsWith('--')) values[flag] = argv[++index]!;
    else values[flag] = true;
  }
  return { command, values };
}

function flag(values: ParsedArgs['values'], name: string) { return values[name]; }
function text(values: ParsedArgs['values'], name: string) {
  const value = flag(values, name);
  if (typeof value !== 'string' || !value.trim()) throw new FmError(EXIT.usage, 'usage', `--${name} requires a value.`);
  return value;
}
function optionalText(values: ParsedArgs['values'], name: string) {
  const value = flag(values, name);
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) throw new FmError(EXIT.usage, 'usage', `--${name} requires a value.`);
  return value;
}
function network(values: ParsedArgs['values']) {
  const value = optionalText(values, 'network') ?? process.env.FM_NETWORK ?? 'testnet';
  if (value !== 'localnet' && value !== 'testnet') throw new FmError(EXIT.usage, 'usage', '--network must be localnet or testnet.');
  return value;
}
function isJson(values: ParsedArgs['values']) { return flag(values, 'json') === true; }
function deploymentArg(values: ParsedArgs['values']) { return optionalText(values, 'deployment'); }
function enabled(values: ParsedArgs['values'], name: string) {
  const value = flag(values, name);
  if (value === undefined) return false;
  if (value !== true) throw new FmError(EXIT.usage, 'usage', `--${name} does not take a value.`);
  return true;
}
function writeOptions(values: ParsedArgs['values']): WriteOptions {
  return { dryRun: enabled(values, 'dry-run'), requestId: optionalText(values, 'request-id'), maxFee: optionalText(values, 'max-fee') };
}
const objectId = /^0x[0-9a-fA-F]+$/;
function object(value: string | undefined, noun: string) {
  if (!value || !objectId.test(value)) throw new FmError(EXIT.usage, 'usage', `${noun} must be a Sui object id.`);
  return value;
}
async function draftFile(path: string | undefined) {
  const source = text({ file: path ?? false }, 'file');
  let parsed: unknown;
  try {
    const raw = await readFile(source, 'utf8');
    if (new TextEncoder().encode(raw).length > 65_504) throw new Error('too large');
    parsed = JSON.parse(raw);
  } catch {
    throw new FmError(EXIT.usage, 'usage', '--file must name a readable JSON draft no larger than 65,504 bytes.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new FmError(EXIT.usage, 'usage', 'The draft file must contain a JSON object.');
  return parsed as Record<string, unknown>;
}
function oneEvidence(values: ParsedArgs['values']) {
  const choices = ['file', 'url', 'text'].flatMap(name => optionalText(values, name) === undefined ? [] : [[name, optionalText(values, name)!] as const]);
  if (choices.length !== 1) throw new FmError(EXIT.usage, 'usage', 'Specify exactly one of --file, --url, or --text.');
  if (new TextEncoder().encode(choices[0]![1]).length > 65_504) throw new FmError(EXIT.usage, 'usage', 'Evidence content is too large.');
  return { [choices[0]![0]]: choices[0]![1] };
}
function warning(weaker: boolean) {
  if (weaker) process.stderr.write('WARNING: using the FM_KEY_PASSPHRASE encrypted-file fallback; it is weaker than the system secret store.\n');
}

async function needsDeployment(net: string, deployment: string | undefined) {
  const loaded = await loadDeployment(net, deployment);
  if (!loaded) throw new FmError(EXIT.usage, 'usage', `No ${net} deployment configuration. Pass --deployment <file> or set FM_DEPLOYMENT_FILE.`);
  return loaded;
}

export async function run(argv: string[], io: { out?: (line: string) => void; err?: (line: string) => void } = {}): Promise<number> {
  const out = io.out ?? (line => process.stdout.write(line));
  const err = io.err ?? (line => process.stderr.write(line));
  try {
    const parsed = parse(argv), [first, second, third] = parsed.command;
    const net = network(parsed.values), json = isJson(parsed.values);
    const output = (value: unknown) => render(value, json, out);
    if (!first || first === 'help' || flag(parsed.values, 'help') === true) {
      output(schema); return EXIT.ok;
    }
    if (first === 'schema' && !second) { output(schema); return EXIT.ok; }
    if (first === 'auth' && second === 'login') {
      const result = await login(await needsDeployment(net, deploymentArg(parsed.values)), {
        organization: text(parsed.values, 'org'), label: optionalText(parsed.values, 'label'), noWait: flag(parsed.values, 'no-wait') === true,
        faucet: flag(parsed.values, 'faucet') === true,
      });
      warning(result.weaker); output(result.result);
      return result.result.needs_funding ? EXIT.needs_funding : EXIT.ok;
    }
    if (first === 'auth' && second === 'status') { output(await status(net)); return EXIT.ok; }
    if (first === 'auth' && second === 'logout') { output(await logout(net)); return EXIT.ok; }
    if (first === 'whoami' && !second) { output(await whoami(net)); return EXIT.ok; }
    if (first === 'org' && second === 'show' && !third) { output(await orgShow(net)); return EXIT.ok; }
    if (first === 'okr' && second === 'list' && !third) { output(await okrList(net)); return EXIT.ok; }
    if (first === 'okr' && second === 'show') { output(await okrShow(net, third)); return EXIT.ok; }
    if (first === 'host' && second === 'list' && !third) { output(await hostList(net)); return EXIT.ok; }
    if (first === 'host' && second === 'show') { output(await hostShow(net, third)); return EXIT.ok; }
    if (first === 'agent' && second === 'list' && !third) { output(await agentList(net)); return EXIT.ok; }
    if (first === 'agent' && second === 'show') { output(await agentShow(net, third)); return EXIT.ok; }
    if (first === 'run' && second === 'list' && !third) { output(await runList(net)); return EXIT.ok; }
    if (first === 'run' && second === 'show') { output(await runShow(net, third)); return EXIT.ok; }
    if (first === 'approval' && second === 'list' && !third) { output(await approvalList(net)); return EXIT.ok; }
    if (first === 'approval' && second === 'show') { output(await approvalShow(net, third)); return EXIT.ok; }

    if (first === 'run' && second === 'pause' && third) {
      output(await pauseRun(net, object(third, 'Run id'), writeOptions(parsed.values))); return EXIT.ok;
    }
    if (first === 'okr' && second === 'draft' && third === 'create') {
      const draft = await draftFile(optionalText(parsed.values, 'file'));
      output(await createOkrDraft(net, draft, writeOptions(parsed.values))); return EXIT.ok;
    }
    if (first === 'okr' && second === 'draft' && third === 'update') {
      const okrId = object(parsed.command[3], 'OKR id');
      output(await updateOkrDraft(net, okrId, await draftFile(optionalText(parsed.values, 'file')), writeOptions(parsed.values))); return EXIT.ok;
    }
    if (first === 'kr' && second === 'progress' && third) {
      writeOptions(parsed.values);
      const kr = object(third, 'KR id');
      const value = text(parsed.values, 'value');
      if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value)) throw new FmError(EXIT.usage, 'usage', '--value must be a non-negative decimal with at most six fractional digits.');
      const note = optionalText(parsed.values, 'note');
      if (note && new TextEncoder().encode(note).length > 4096) throw new FmError(EXIT.usage, 'usage', '--note is limited to 4,096 bytes.');
      approvalRequired({ action: 'kr.progress', reason: 'KR observations require a RemoteCapability and execution evidence; an Agent Operator cannot forge either.', title: 'Record KR progress', body: note ?? `Record progress ${value}.`, ref: kr });
    }
    if (first === 'kr' && second === 'evidence' && third === 'add') {
      writeOptions(parsed.values);
      const kr = object(parsed.command[3], 'KR id');
      const evidence = oneEvidence(parsed.values);
      approvalRequired({ action: 'kr.evidence.add', reason: 'The App evidence path is execution-attested and requires a RemoteCapability; an Agent Operator cannot create an unattested substitute.', title: 'Add KR evidence', body: JSON.stringify(evidence), ref: kr });
    }
    if (first === 'agent' && second === 'message' && third && parsed.command[3]) {
      const target = third, message = parsed.command[3]!;
      if (new TextEncoder().encode(message).length > 4096) throw new FmError(EXIT.usage, 'usage', 'Message is limited to 4,096 bytes.');
      output(await messageAgent(net, target, message, writeOptions(parsed.values))); return EXIT.ok;
    }
    if (first === 'approval' && second === 'request' && third) {
      const kind = third;
      if (!/^[a-z][a-z0-9._-]{0,63}$/.test(kind)) throw new FmError(EXIT.usage, 'usage', '<kind> must be a lowercase identifier up to 64 characters.');
      const title = text(parsed.values, 'title'), body = text(parsed.values, 'body'), ref = optionalText(parsed.values, 'ref');
      if (ref) object(ref, '--ref');
      output(await requestApproval(net, kind, title, body, ref, writeOptions(parsed.values))); return EXIT.ok;
    }
    if (first === 'events' && !second && flag(parsed.values, 'follow') === true) {
      let cursor: string | null = null;
      // eventPage deliberately authorizes again on every poll.
      while (true) {
        const page = await eventPage(net, cursor);
        for (const event of page.events) output(event);
        cursor = page.cursor ?? cursor;
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    }
    throw new FmError(EXIT.usage, 'usage', `Unknown command: ${parsed.command.join(' ') || '(empty)'}. Run fm schema.`);
  } catch (error) { return emitError(error, err); }
}

if (import.meta.url === new URL(process.argv[1]!, 'file:').href) {
  const code = await run(process.argv.slice(2));
  process.exitCode = code;
}
