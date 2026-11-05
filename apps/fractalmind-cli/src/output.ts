export const EXIT = Object.freeze({
  ok: 0,
  usage: 2,
  needs_funding: 3,
  not_authorized: 4,
  revoked_or_expired: 5,
  chain_unreachable: 6,
  not_found: 7,
  needs_approval: 8,
  fee_exceeds_limit: 9,
  conflict: 10,
});
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export class FmError extends Error {
  constructor(
    readonly exitCode: ExitCode,
    readonly code: keyof typeof EXIT,
    detail: string,
    readonly data?: Record<string, unknown>,
  ) { super(detail); }
}

export const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
export const jsonMode = (forced: boolean) => forced || !process.stdout.isTTY;

function scalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? json(value) : String(value);
}

export function render(value: unknown, forceJson: boolean, write: (line: string) => void = line => process.stdout.write(line)) {
  if (jsonMode(forceJson)) { write(`${json(value)}\n`); return; }
  const rows = Array.isArray(value) ? value : [value];
  if (!rows.length) { write('(none)\n'); return; }
  if (!rows.every(row => row && typeof row === 'object' && !Array.isArray(row))) { write(`${rows.map(scalar).join('\n')}\n`); return; }
  const keys = [...new Set(rows.flatMap(row => Object.keys(row as Record<string, unknown>)))];
  const widths = keys.map(key => Math.max(key.length, ...rows.map(row => scalar((row as Record<string, unknown>)[key]).length)));
  write(`${keys.map((key, i) => key.padEnd(widths[i]!)).join('  ')}\n`);
  write(`${widths.map(width => '-'.repeat(width)).join('  ')}\n`);
  for (const row of rows) write(`${keys.map((key, i) => scalar((row as Record<string, unknown>)[key]).padEnd(widths[i]!)).join('  ')}\n`);
}

export function emitError(error: unknown, write: (line: string) => void = line => process.stderr.write(line)): ExitCode {
  if (error instanceof FmError) {
    write(`${json({ error: error.code, code: error.exitCode, detail: error.message, ...(error.data ?? {}) })}\n`);
    return error.exitCode;
  }
  write(`${json({ error: 'chain_unreachable', code: EXIT.chain_unreachable, detail: error instanceof Error ? error.message : String(error) })}\n`);
  return EXIT.chain_unreachable;
}
