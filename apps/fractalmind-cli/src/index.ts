#!/usr/bin/env node
import { login, logout, status } from './auth.js';
import { EXIT, emitError, FmError, render } from './output.js';
import { approvalList, agentList, agentShow, eventPage, hostList, hostShow, okrList, okrShow, orgShow, runList, runShow, schema, whoami } from './readers.js';
import { loadDeployment } from './storage.js';
import type { ParsedArgs } from './types.js';

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
function optionalText(values: ParsedArgs['values'], name: string) { const value = flag(values, name); return typeof value === 'string' ? value : undefined; }
function network(values: ParsedArgs['values']) {
  const value = optionalText(values, 'network') ?? process.env.FM_NETWORK ?? 'testnet';
  if (value !== 'localnet' && value !== 'testnet') throw new FmError(EXIT.usage, 'usage', '--network must be localnet or testnet.');
  return value;
}
function isJson(values: ParsedArgs['values']) { return flag(values, 'json') === true; }
function deploymentArg(values: ParsedArgs['values']) { return optionalText(values, 'deployment'); }
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
