import { bcs } from '@mysten/sui/bcs';
import { sha256 } from '@noble/hashes/sha2.js';

const Boundary = bcs.vector(bcs.struct('BoundaryAction', { action: bcs.string(), directories: bcs.vector(bcs.string()) }));
const encoder = new TextEncoder();
const domain = encoder.encode('fractalmind.execution-boundary.v1');
const actions = new Set(['file.read', 'file.write', 'file.list']);
const compare = (a: string, b: string) => {
  const x = encoder.encode(a), y = encoder.encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
};
/** Hash approved path sets independently of each command's tool-call budget.
 * UTF-8 byte ordering and BCS match envd; duplicate paths are rejected. */
export function executionBoundaryHash(paths: Record<string, string[]>): Uint8Array {
  const entries = Object.entries(paths);
  if (entries.length < 1 || entries.length > 3) throw new Error('Expected 1–3 file tool boundaries.');
  const rows = entries.map(([action, directories]) => {
    if (!actions.has(action) || !Array.isArray(directories) || directories.length < 1 || directories.length > 16 || new Set(directories).size !== directories.length) throw new Error('Invalid file tool boundary.');
    for (const directory of directories) {
      if (typeof directory !== 'string') throw new Error('Invalid boundary directory.');
      const encoded = encoder.encode(directory);
      if (!encoded.length || encoded.length > 1024 || new TextDecoder('utf-8', { fatal: true }).decode(encoded) !== directory) throw new Error('Invalid UTF-8 directory.');
    }
    return { action, directories: [...directories].sort(compare) };
  }).sort((a, b) => compare(a.action, b.action));
  const bytes = Boundary.serialize(rows).toBytes();
  const input = new Uint8Array(domain.length + bytes.length); input.set(domain); input.set(bytes, domain.length);
  return sha256(input);
}
