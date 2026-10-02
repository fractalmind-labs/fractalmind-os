/** Companion for manual installed-App acceptance. Localnet/test-* keys only.
 * create prepares the second device's chain request; approve/share use the UI.
 * verify proves that device's real grant; remove cleans its isolated OS keys. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { MemoryTransactionJournal } from "@fractalmind-labs/fractalmind-sdk";
import { ChainReadSession } from "../src/chain";
import { NativeDeviceSigner, type NativeInvoke } from "../src/native-device";
import { DevicePairing } from "../src/pairing";

const [mode, path, humanId, output] = process.argv.slice(2);
assert.ok(["create", "verify", "remove"].includes(mode));
assert.ok(path);
const helper = resolve("native/target/debug/examples/device-test-helper");
let profile: string;
function request(action: string, extra: Record<string, string> = {}) {
  assert.ok(profile.startsWith("test-"));
  const result = spawnSync(helper, [], {
    input: JSON.stringify({ action, profile, ...extra }),
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
const invoke: NativeInvoke = async (command, args) => {
  assert.equal(args.profile, profile);
  switch (command) {
    case "fm_device_public":
      return request("public");
    case "fm_device_initialize":
      return request("initialize");
    case "fm_device_sign_transaction":
      return request("signTransaction", { bytes: args.bytes });
    case "fm_device_prove":
      return request("proveDevice", { challenge: args.challenge });
    default:
      throw new Error("Unsupported isolated fixture command");
  }
};
if (mode === "create") {
  assert.match(humanId ?? "", /^0x[0-9a-f]{64}$/);
  assert.ok(output);
  const deployment = JSON.parse(await readFile(path, "utf8"));
  const publicConnection = {
    network: "localnet" as const,
    rpcUrl: "http://127.0.0.1:29000",
    packageId: deployment.packageId,
    registryId: deployment.registryId,
    humanId,
    chainIdentifier: deployment.chain.chainIdentifier,
  };
  const chain = new ChainReadSession(publicConnection);
  const identity = await chain.human();
  assert.equal(
    identity.human.organizations.length,
    1,
    "Use a synthetic single-organization UI identity",
  );
  const organizationId = identity.human.organizations[0];
  profile = "test-ui-pair-" + randomUUID().slice(0, 8);
  const device = await NativeDeviceSigner.initialize(invoke, profile);
  const pairing = new DevicePairing(
    chain,
    device,
    new MemoryTransactionJournal(),
    invoke,
  );
  try {
    await requestSuiFromFaucetV2({
      host: "http://127.0.0.1:29123",
      recipient: device.device.address,
    });
    const quote = await pairing.prepareCreate(
      organizationId,
      "Native UI second device",
      "macos",
    );
    assert.ok(!("status" in quote));
    const result = await pairing.submit(quote);
    assert.equal(result.status, "confirmed");
    const requestId = pairing.requestFromResult(result);
    // Ledger indexing can trail confirmed effects. Wait for this exact created
    // object only; never repeat the transaction or treat a network error as empty.
    let state: Awaited<ReturnType<DevicePairing["inspect"]>> | undefined;
    for (let attempt = 0; attempt < 50 && !state; attempt++) {
      try {
        state = await pairing.inspect(requestId);
      } catch (e) {
        if (
          !(
            typeof e === "object" &&
            e &&
            "reason" in e &&
            e.reason === "notFound" &&
            "objectId" in e &&
            e.objectId === requestId
          )
        )
          throw e;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    assert.ok(state, "Created request did not become query-visible");
    const report = {
      recordedAt: new Date().toISOString(),
      profile,
      publicConnection,
      organizationId,
      requestId,
      fingerprint: state.fingerprint,
      device: device.device,
      digest: result.digest,
      actualGas: result.actualGas,
      limits: {
        localnet: true,
        secondDeviceUsesSubprocess: true,
        uiApprovalAndSharingPending: true,
        keysRetainedForUiAcceptance: true,
      },
    };
    await writeFile(output, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
  } catch (e) {
    request("remove");
    throw e;
  }
} else {
  const report = JSON.parse(await readFile(path, "utf8"));
  profile = report.profile;
  assert.equal(report.publicConnection.network, "localnet");
  assert.equal(report.publicConnection.rpcUrl, "http://127.0.0.1:29000");
  if (mode === "remove") {
    request("remove");
    console.log("Removed isolated fixture device");
  } else {
    const device = await NativeDeviceSigner.load(invoke, profile);
    const pairing = new DevicePairing(
      new ChainReadSession(report.publicConnection),
      device,
      new MemoryTransactionJournal(),
      invoke,
    );
    const state = await pairing.inspect(report.requestId);
    const proof = await pairing.verifyRequester(report.requestId);
    assert.equal(state.fingerprint, report.fingerprint);
    assert.equal(state.request.status, 1);
    assert.equal(
      state.grant?.encrypted_keys.length! > 0,
      true,
      "UI must explicitly share the selected organization data",
    );
    report.uiResult = {
      requestStatus: state.request.status,
      grantId: state.grant?.id,
      encryptedEnvelopeBytes: state.grant?.encrypted_keys.length,
      requesterVerified: Boolean(proof),
      fingerprint: state.fingerprint,
      verifiedAt: new Date().toISOString(),
    };
    report.limits.uiApprovalAndSharingPending = false;
    await writeFile(path, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report.uiResult));
  }
}
