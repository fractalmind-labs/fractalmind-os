import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

export const LOCAL_FIXTURE_PATH = new URL("../src/lib/testdata/node-command-v1-golden.json", import.meta.url);
export const CANONICAL_PROTOCOL_COMMIT = "c0c06062e6784ebd2c15b167fd074c9f1c32db90";
export const CANONICAL_FIXTURE_PATH = "fixtures/node-command/v1-golden.json";
export const CANONICAL_FIXTURE_URL = `https://raw.githubusercontent.com/fractalmind-ai/fractalmind-protocol/${CANONICAL_PROTOCOL_COMMIT}/${CANONICAL_FIXTURE_PATH}`;
export const CANONICAL_FIXTURE_SHA256 = "f4fb11b9194abbafad3bd1a674c0dc4895f14b726f2f24d8862feeb95c9e8a44";
export const SOURCE_UNAVAILABLE_EXIT = 2;

export class SourceUnavailableError extends Error {}

if (isDirectRun()) {
  await main(process.argv);
}

export async function main(argv = process.argv, io = process) {
  try {
    const result = await verifyCanonicalSource({ selfTestLocalHashBypass: argv.includes("--self-test-local-hash-bypass") });
    io.stdout.write(result.message + "\n");
    io.exit(0);
  } catch (error) {
    if (error instanceof SourceUnavailableError) {
      io.stderr.write(`CANONICAL_SOURCE_UNAVAILABLE: ${error.message}\n`);
      io.exit(SOURCE_UNAVAILABLE_EXIT);
      return;
    }
    if (error instanceof VerificationFailure) {
      io.stderr.write(error.message + "\n");
      io.exit(1);
      return;
    }
    throw error;
  }
}

export async function verifyCanonicalSource({ selfTestLocalHashBypass = false, fetchImpl = globalThis.fetch } = {}) {
  const localRaw = await readFile(LOCAL_FIXTURE_PATH, "utf8");
  const canonicalRaw = await fetchCanonicalFixture(fetchImpl);
  const canonicalSha = sha256(canonicalRaw);
  if (canonicalSha !== CANONICAL_FIXTURE_SHA256) {
    throw new VerificationFailure(
      `canonical-source changed unexpectedly: ${CANONICAL_FIXTURE_URL}\n` +
        `got sha256=${canonicalSha}, want sha256=${CANONICAL_FIXTURE_SHA256}`,
    );
  }

  if (selfTestLocalHashBypass) {
    const tamperedRaw = localRaw.replace('"action": "deploy"', '"action": "status"');
    if (tamperedRaw === localRaw) {
      throw new VerificationFailure("self-test setup failed: fixture mutation did not change local bytes");
    }
    const tamperedSha = sha256(tamperedRaw);
    if (tamperedRaw === canonicalRaw) {
      throw new VerificationFailure("self-test failed: tampered local fixture still matched canonical source");
    }
    return {
      message:
        "PASS: canonical-source check catches a mutated local fixture even if a local hash is recomputed " +
        `(tampered local sha256=${tamperedSha}, canonical sha256=${canonicalSha})`,
    };
  }

  const localSha = sha256(localRaw);
  if (localRaw !== canonicalRaw) {
    throw new VerificationFailure(
      `NodeCommand fixture mismatch against canonical source ${CANONICAL_FIXTURE_URL}\n` +
        `local sha256=${localSha}\ncanonical sha256=${canonicalSha}`,
    );
  }
  return {
    message:
      `PASS: local NodeCommand fixture matches ${CANONICAL_FIXTURE_URL} ` +
      `(sha256=${localSha})`,
  };
}

export async function fetchCanonicalFixture(fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== "function") {
    throw new SourceUnavailableError("fetch is unavailable in this runtime");
  }
  let response;
  try {
    response = await fetchImpl(CANONICAL_FIXTURE_URL, { signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new SourceUnavailableError(`fetch failed for ${CANONICAL_FIXTURE_URL}: ${error.message}`);
  }
  if (!response.ok) {
    throw new SourceUnavailableError(`HTTP ${response.status} for ${CANONICAL_FIXTURE_URL}`);
  }
  return response.text();
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isDirectRun() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

class VerificationFailure extends Error {}
