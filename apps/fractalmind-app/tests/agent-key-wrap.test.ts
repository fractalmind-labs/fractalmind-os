import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeviceEncryptionKeys,
  unwrapKeys,
  wrapKeys,
} from "@fractalmind-labs/fractalmind-sdk";
import { toBase64 } from "@mysten/sui/utils";
import { wrapOrgKeysForAgent } from "../src/pairing";
import type { NativeInvoke } from "../src/native-device";

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

test("wrapOrgKeysForAgent keeps the desktop wrapping seam inside the native vault", async () => {
  const recipient = createDeviceEncryptionKeys();
  const address = "0x00000000000000000000000000000000000000000000000000000000000000aa";
  const organizationId = "0x00000000000000000000000000000000000000000000000000000000000000bb";
  const keyring = new Uint8Array([9, 8, 7]);
  const invoke: NativeInvoke = async (command, args) => {
    assert.equal(command, "fm_device_wrap_organization_keys");
    const request = JSON.parse(args.request) as Record<string, unknown>;
    assert.equal(args.profile, "test-agent-wrap");
    assert.equal(request.organizationId, organizationId);
    assert.equal(request.recipientAddress, address);
    return toBase64(await wrapKeys(
      keyring,
      recipient.publicKey,
      `fractalmind.device-keys.v1:localnet:${address}`,
    ));
  };
  try {
    const envelope = await wrapOrgKeysForAgent({
      invoke,
      profile: "test-agent-wrap",
      network: "localnet",
      organizationId,
      keyVersion: "1",
      organizationCount: 1,
      encryptedKeys: "owner-envelope",
      recipientAddress: address,
      signingPublicKey: new Uint8Array(32),
      encryptionPublicKey: recipient.publicKey,
    });
    assert.deepEqual(
      await unwrapKeys(
        envelope,
        recipient.secret,
        `fractalmind.device-keys.v1:localnet:${address}`,
      ),
      keyring,
    );
  } finally {
    recipient.secret.fill(0);
  }
});
