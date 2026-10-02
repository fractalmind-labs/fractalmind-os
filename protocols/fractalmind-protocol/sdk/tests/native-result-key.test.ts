import assert from "node:assert/strict";
import test from "node:test";
import { bcs } from "@mysten/sui/bcs";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64, normalizeSuiAddress as id } from "@mysten/sui/utils";
import { x25519 } from "@noble/curves/ed25519.js";
import type { ClientWithCoreApi } from "@mysten/sui/client";
import { FractalMindClient } from "../src/client.js";
import { HostMembershipBcs } from "../src/host.js";
import {
  NodeExecutionApi,
  nodeCommandIntentHash,
  type WrappedCommandResultKey,
} from "../src/node-execution.js";
import { bytesToHex, wrapKeys } from "../src/identity-crypto.js";
import {
  commandResultKey,
  commandResultWrapContext,
} from "../src/command-result-crypto.js";
import { signNodeCommand } from "../src/node-command.js";

async function fixture() {
  const device = Ed25519Keypair.generate(),
    host = Ed25519Keypair.generate(),
    org = id("0x1"),
    pkg = id("0x2");
  const membershipId = id("0x3"),
    bindingId = id("0x4"),
    cap = id("0x5"),
    hostSecret = x25519.utils.randomSecretKey();
  const command = await signNodeCommand(device, {
    target: {
      organizationId: org,
      nodeId: host.toSuiAddress(),
      agentId: "native-" + "11".repeat(32),
    },
    action: "status",
    scope: "observation",
    capability: { id: cap, revocationVersion: 1n },
    payload: {},
  });
  const publicKey = x25519.getPublicKey(hostSecret),
    intentHash = bytesToHex(nodeCommandIntentHash(command));
  const derived = commandResultKey(
    new Uint8Array(32).fill(9),
    org,
    intentHash,
    "2",
  );
  const wrappedKey = await wrapKeys(
    derived,
    publicKey,
    commandResultWrapContext(org, cap, membershipId, intentHash, "2"),
  );
  derived.fill(0);
  const member = {
    id: membershipId,
    org_id: org,
    host_address: host.toSuiAddress(),
    host_public_key: Array.from(host.getPublicKey().toRawBytes()),
    encryption_public_key: Array.from(publicKey),
    name: "Host",
    coordinator_binding: bindingId,
    version: "1",
    revoked: false,
    expires_at_ms: String(Date.now() + 60000),
    joined_at_ms: "1",
    source_invite: id("0x6"),
    observation_capability: id("0x7"),
  };
  let onRead = () => {};
  const api = new NodeExecutionApi(
    new FractalMindClient({
      packageId: pkg,
      client: {
        core: {
          getObject: async () => {
            onRead();
            return {
              object: {
                type: `${pkg}::host::HostMembership`,
                owner: { $kind: "Shared" },
                content: HostMembershipBcs.serialize(member).toBytes(),
              },
            };
          },
        },
      } as unknown as ClientWithCoreApi,
    }),
  );
  const resultKey: WrappedCommandResultKey = {
    wrappedKey,
    keyVersion: "2",
    organizationId: org,
    capabilityId: cap,
    membershipId,
    hostAddress: member.host_address,
    hostEncryptionPublicKey: publicKey,
    intentHash,
  };
  const input = {
    command,
    humanId: id("0x8"),
    grantId: id("0x9"),
    membershipId,
    bindingId,
    managedAgentId: id("0xa"),
    resultKey,
  };
  return {
    api,
    input,
    member,
    onRead: (f: () => void) => {
      onRead = f;
    },
  };
}
test("native ciphertext grants exactly one command result key in the same tracked preparation PTB", async () => {
  const f = await fixture(),
    tx = await f.api.prepareCommand(f.input),
    data = tx.getData();
  assert.deepEqual(
    data.commands.map((c) => c.MoveCall?.function),
    ["grant_result_key", "prepare_agent_command_v2"],
  );
  const arg = data.commands[0].MoveCall!.arguments[8];
  assert.ok("Input" in arg);
  assert.deepEqual(
    bcs.vector(bcs.u8()).parse(fromBase64(data.inputs[arg.Input].Pure!.bytes)),
    Array.from(f.input.resultKey.wrappedKey),
  );
  assert.equal("organizationKey" in f.input.resultKey, false);
});
test("native ciphertext cannot be attached to another command, Host, membership, key or version", async () => {
  const f = await fixture();
  for (const change of [
    (k: WrappedCommandResultKey) => {
      k.organizationId = id("0xff");
    },
    (k: WrappedCommandResultKey) => {
      k.capabilityId = id("0xff");
    },
    (k: WrappedCommandResultKey) => {
      k.membershipId = id("0xff");
    },
    (k: WrappedCommandResultKey) => {
      k.hostAddress = id("0xff");
    },
    (k: WrappedCommandResultKey) => {
      k.intentHash = "ff".repeat(32);
    },
    (k: WrappedCommandResultKey) => {
      k.hostEncryptionPublicKey = new Uint8Array(32);
    },
    (k: WrappedCommandResultKey) => {
      k.keyVersion = "0";
    },
    (k: WrappedCommandResultKey) => {
      k.keyVersion = "18446744073709551616";
    },
    (k: WrappedCommandResultKey) => {
      k.wrappedKey = new Uint8Array(132);
    },
    (k: WrappedCommandResultKey) => {
      k.wrappedKey = k.wrappedKey.slice(0, 131);
    },
    (k: WrappedCommandResultKey) => {
      k.wrappedKey[68] = 0;
    },
    (k: WrappedCommandResultKey) => {
      (k as any).organizationKey = new Uint8Array(32);
    },
  ]) {
    const input = structuredClone(f.input);
    change(input.resultKey);
    await assert.rejects(f.api.prepareCommand(input));
  }
  f.member.revoked = true;
  await assert.rejects(f.api.prepareCommand(f.input));
  f.member.revoked = false;
  f.member.coordinator_binding = id("0xff");
  await assert.rejects(f.api.prepareCommand(f.input));
});
test("preparation snapshots command and ciphertext before asynchronous membership reads", async () => {
  const f = await fixture(),
    original = f.input.command.action;
  f.onRead(() => {
    f.input.resultKey.wrappedKey.fill(0);
    f.input.command.action = "assign";
    f.input.membershipId = id("0xff");
  });
  const tx = await f.api.prepareCommand(f.input),
    data = tx.getData();
  assert.equal(data.commands[1].MoveCall!.function, "prepare_agent_command_v2");
  const keyArg = data.commands[0].MoveCall!.arguments[8];
  assert.ok("Input" in keyArg);
  const body = bcs
    .vector(bcs.u8())
    .parse(fromBase64(data.inputs[keyArg.Input].Pure!.bytes));
  assert.equal(
    new TextDecoder().decode(Uint8Array.from(body.slice(0, 4))),
    "FMW1",
  );
  assert.equal(original, "status");
});
