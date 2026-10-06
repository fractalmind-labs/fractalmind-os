import test from 'node:test';
import assert from 'node:assert/strict';
import { executionBoundaryHash } from '../src/execution-boundary.js';
const hex = (paths: Record<string, string[]>) => Buffer.from(executionBoundaryHash(paths)).toString('hex');
test('approved boundary matches independent BCS/SHA-256 and Go vector', () => {
  assert.equal(hex({ 'file.write': ['.'], 'file.read': ['.'] }), '23ff5a9204bd4625deb00c95ab445ba3b5a49dba9c378e4be22532c52eedef8d');
  assert.equal(hex({ 'file.read': ['𐀀', '\ue000'] }), hex({ 'file.read': ['\ue000', '𐀀'] }));
  assert.notEqual(hex({ 'file.read': ['.'] }), hex({ 'file.read': ['private'] }));
});
test('ambiguous, empty and unsupported file boundaries fail before signing', () => {
  for (const paths of [{}, { 'shell.exec': ['.'] }, { 'file.read': [] }, { 'file.read': ['.', '.'] }, { 'file.read': ['\ud800'] }]) assert.throws(() => executionBoundaryHash(paths));
});
