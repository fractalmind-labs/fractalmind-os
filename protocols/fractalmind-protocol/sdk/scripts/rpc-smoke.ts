import assert from 'node:assert/strict';
import { FractalMindSDK } from '../src/index.js';

// Public reads only. No wallet, signature, or gas is needed.
const sdk = new FractalMindSDK({ packageId: '0x2', network: 'testnet' });
const clock = await sdk.client.getMoveObject('0x6');
assert.match(clock.type, /::clock::Clock$/);
assert(BigInt(String(clock.fields.timestamp_ms)) > 0n);
console.log('Testnet gRPC Core API object read passed.');
