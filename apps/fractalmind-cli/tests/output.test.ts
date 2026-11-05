import assert from 'node:assert/strict';
import test from 'node:test';
import { emitError, EXIT, FmError, render } from '../src/output.js';

test('machine output is JSON with BigInt values made safe', () => {
  const lines: string[] = [];
  render({ value: 7n }, true, line => lines.push(line));
  assert.deepEqual(lines, ['{"value":"7"}\n']);
});

test('stable errors use JSON stderr contract', () => {
  const lines: string[] = [];
  assert.equal(emitError(new FmError(EXIT.not_authorized, 'not_authorized', 'missing READ'), line => lines.push(line)), 4);
  assert.deepEqual(JSON.parse(lines[0]!), { error: 'not_authorized', code: 4, detail: 'missing READ' });
});
