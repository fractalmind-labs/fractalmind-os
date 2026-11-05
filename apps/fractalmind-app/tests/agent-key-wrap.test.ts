import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeviceEncryptionKeys,
  unwrapKeys,
} from "@fractalmind-labs/fractalmind-sdk";
import { wrapOrgKeysForAgent } from "../src/pairing";

test("wrapOrgKeysForAgent binds a keyring to the exact Agent network and address", async () => {
  const recipient = createDeviceEncryptionKeys();
  const address = "0x00000000000000000000000000000000000000000000000000000000000000aa";
  const plaintext = new Uint8Array([1, 2, 3, 4]);
  try {
    const envelope = await wrapOrgKeysForAgent(plaintext, recipient.publicKey, "localnet", address);
    assert.deepEqual(
      await unwrapKeys(
        envelope,
        recipient.secret,
        `fractalmind.device-keys.v1:localnet:${address}`,
      ),
      plaintext,
    );
    await assert.rejects(
      unwrapKeys(envelope, recipient.secret, `fractalmind.device-keys.v1:testnet:${address}`),
    );
  } finally {
    recipient.secret.fill(0);
  }
});

test("wrapOrgKeysForAgent rejects a missing keyring or malformed recipient", async () => {
  const recipient = createDeviceEncryptionKeys();
  try {
    await assert.rejects(wrapOrgKeysForAgent(new Uint8Array(), recipient.publicKey, "localnet", "0x1"));
    await assert.rejects(wrapOrgKeysForAgent(new Uint8Array([1]), new Uint8Array(31), "localnet", "0x1"));
  } finally {
    recipient.secret.fill(0);
  }
});
