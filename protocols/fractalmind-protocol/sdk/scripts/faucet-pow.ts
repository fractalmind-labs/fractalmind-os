/** Official public faucet v3. Public addresses/proofs only; no wallet or signing.
 * Persist the exact proof before POST. An uncertain payout never starts new work.
 * Usage: node --import tsx scripts/faucet-pow.ts testnet 0x... /tmp/payout.json
 * Resume using the same arguments and report path. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { argon2d } from "@noble/hashes/argon2.js";
import * as crypto from "node:crypto";
import { SuiGrpcClient } from "@mysten/sui/grpc";

const [network, recipient, output] = process.argv.slice(2);
assert.ok(
  network === "testnet" || network === "devnet",
  "Only public test networks are supported",
);
assert.match(recipient ?? "", /^0x[0-9a-f]{64}$/);
assert.ok(
  output,
  "Provide a durable output path; reuse it after an uncertain result",
);
const endpoint = `https://faucet.${network}.sui.io`;
const client = new SuiGrpcClient({
  network,
  baseUrl: `https://fullnode.${network}.sui.io:443`,
});
const { chainIdentifier } = await client.core.getChainIdentifier();
const options = { m: 8192, t: 1, p: 1, dkLen: 32, version: 19 };
// Node 24.7+ has a native implementation; official vectors check its fixed
// algorithm/version as well. Node 22 remains supported by the Noble fallback.
const nativeArgon = (
  crypto as unknown as {
    argon2Sync?: (
      algorithm: string,
      options: {
        message: Buffer;
        nonce: Buffer;
        parallelism: number;
        tagLength: number;
        memory: number;
        passes: number;
      },
    ) => Buffer;
  }
).argon2Sync;
function hash(preimage: string) {
  return nativeArgon
    ? nativeArgon("argon2d", {
        message: Buffer.from(preimage),
        nonce: Buffer.from("sui-faucet-pow-1"),
        parallelism: 1,
        tagLength: 32,
        memory: 8192,
        passes: 1,
      })
    : Buffer.from(argon2d(preimage, "sui-faucet-pow-1", options));
}
type Proof = {
  recipient: string;
  checkpointSeq: string;
  nonce: string;
  hashHex: string;
};
type Report = {
  network: string;
  endpoint: string;
  recipient: string;
  chainIdentifier: string;
  state: "submitting" | "unknown" | "reported" | "confirmed";
  proof: Proof;
  response?: Record<string, unknown>;
  digest?: string;
  balanceMist?: string;
  updatedAt: string;
};
let report: Report | undefined;
try {
  report = JSON.parse(await readFile(output, "utf8"));
} catch (e) {
  if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
}
async function save() {
  assert.ok(report);
  report.updatedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
    mode: 0o600,
  });
}
if (report) {
  assert.equal(report.network, network);
  assert.equal(report.endpoint, endpoint);
  assert.equal(report.recipient, recipient);
  assert.equal(report.chainIdentifier, chainIdentifier);
  assert.equal(report.proof.recipient, recipient);
  assert.match(report.proof.checkpointSeq, /^(0|[1-9][0-9]*)$/);
  assert.match(report.proof.nonce, /^(0|[1-9][0-9]*)$/);
  assert.match(report.proof.hashHex, /^[0-9a-f]{64}$/);
} else {
  // Check the exact official vectors before grinding. No dependency install.
  const vectorsResponse = await fetch(
    "https://faucet.sui.io/pow-spec/pow-vectors.json",
    { signal: AbortSignal.timeout(15000) },
  );
  assert.ok(vectorsResponse.ok);
  const vectors = (await vectorsResponse.json()) as {
    salt: string;
    cases: Array<{ preimage: string; hash: string }>;
  };
  assert.equal(vectors.salt, "sui-faucet-pow-1");
  assert.ok(vectors.cases.length >= 2);
  for (const vector of vectors.cases)
    assert.equal(hash(vector.preimage).toString("hex"), vector.hash);
  console.log(
    JSON.stringify({
      conformanceVectorsPassed: vectors.cases.length,
      network,
      recipient,
    }),
  );
  // A stale challenge can be replaced only before any payout submission.
  for (let attempt = 0; attempt < 3 && !report; attempt++) {
    const response = await fetch(
      `${endpoint}/v3/challenge?recipient=${recipient}`,
      { signal: AbortSignal.timeout(15000) },
    );
    assert.ok(response.ok, `Challenge unavailable: ${response.status}`);
    const c = (await response.json()) as Record<string, unknown>;
    for (const [field, value] of Object.entries({
      version: 1,
      domain: "sui-faucet-pow/1",
      algorithm: "argon2d",
      argon2Version: 19,
      memorySize: 8192,
      iterations: 1,
      parallelism: 1,
      hashLength: 32,
      salt: "sui-faucet-pow-1",
      network,
      recipient,
      chainId: chainIdentifier,
    }))
      assert.equal(c[field], value, field);
    for (const field of [
      "checkpointSeq",
      "difficulty",
      "threshold",
      "amountMist",
    ])
      assert.match(String(c[field]), /^(0|[1-9][0-9]*)$/);
    assert.ok(
      BigInt(String(c.difficulty)) >= 2n &&
        BigInt(String(c.difficulty)) <= 2n ** 48n,
    );
    const threshold = BigInt(String(c.threshold));
    assert.equal(threshold, 2n ** 64n / BigInt(String(c.difficulty)));
    assert.match(String(c.faucetAddress), /^0x[0-9a-f]{64}$/);
    assert.match(String(c.checkpointDigest), /^[1-9A-HJ-NP-Za-km-z]{43,44}$/);
    assert.equal(
      Buffer.from(String(c.randomBytes), "base64").toString("base64"),
      c.randomBytes,
    );
    assert.ok(
      typeof c.windowSeconds === "number" &&
        c.windowSeconds >= 10 &&
        c.windowSeconds <= 3600,
    );
    const fields = [
      c.domain,
      c.chainId,
      c.checkpointSeq,
      c.checkpointDigest,
      c.randomBytes,
      c.faucetAddress,
      recipient,
    ].map(String);
    assert.ok(fields.every((v) => !v.includes("\n")));
    const start = performance.now(),
      deadline = start + Math.min(50000, (c.windowSeconds - 5) * 1000);
    for (let nonce = 0n; performance.now() < deadline; nonce++) {
      const resultHash = hash([...fields, nonce.toString()].join("\n"));
      if (resultHash.readBigUInt64BE(0) < threshold) {
        report = {
          network,
          endpoint,
          recipient,
          chainIdentifier,
          state: "submitting",
          updatedAt: "",
          proof: {
            recipient,
            checkpointSeq: String(c.checkpointSeq),
            nonce: nonce.toString(),
            hashHex: resultHash.toString("hex"),
          },
        };
        await save();
        console.log(
          JSON.stringify({
            proofFound: true,
            attempts: (nonce + 1n).toString(),
            elapsedMs: Math.round(performance.now() - start),
          }),
        );
        break;
      }
    }
    if (!report)
      console.log(
        JSON.stringify({
          challengeExpiredBeforeSubmission: true,
          attempt: attempt + 1,
        }),
      );
  }
  assert.ok(
    report,
    "No proof found before freshness deadline; no payout was submitted",
  );
}
if (!report.digest) {
  // Includes resume after lost response: send only the original exact proof.
  try {
    const response = await fetch(`${endpoint}/v3/gas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report.proof),
      signal: AbortSignal.timeout(30000),
    });
    const body = (await response.json()) as Record<string, unknown>;
    report.response = body;
    if (typeof body.digest === "string") report.digest = body.digest;
    report.state = "reported";
    await save();
    console.log(
      JSON.stringify({ httpStatus: response.status, response: body }),
    );
    assert.ok(
      report.digest,
      "No payout digest. Keep this report; no new proof/payment is automatically requested",
    );
  } catch (e) {
    report.state = "unknown";
    await save();
    throw e;
  }
}
// Resolve the original digest, never equate a faucet response with chain success.
const tx = await client.core.getTransaction({
  digest: report.digest!,
  include: { effects: true },
});
const original =
  tx.$kind === "Transaction" ? tx.Transaction : tx.FailedTransaction;
assert.equal(original.digest, report.digest);
assert.equal(original.status.success, true, "Original payout did not succeed");
assert.equal(original.effects?.status.success, true);
const balance = await client.core.getBalance({ owner: recipient });
report.balanceMist = balance.balance.balance;
report.state = "confirmed";
await save();
console.log(
  JSON.stringify({
    state: report.state,
    digest: report.digest,
    balanceMist: report.balanceMist,
    output,
  }),
);
