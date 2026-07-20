import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const LOCAL_FIXTURE_PATH = new URL("../src/lib/testdata/node-command-v1-golden.json", import.meta.url);
const CANONICAL_PROTOCOL_COMMIT = "c0c06062e6784ebd2c15b167fd074c9f1c32db90";
const CANONICAL_FIXTURE_PATH = "fixtures/node-command/v1-golden.json";
const CANONICAL_FIXTURE_URL = `https://raw.githubusercontent.com/fractalmind-ai/fractalmind-protocol/${CANONICAL_PROTOCOL_COMMIT}/${CANONICAL_FIXTURE_PATH}`;
const CANONICAL_FIXTURE_SHA256 = "f4fb11b9194abbafad3bd1a674c0dc4895f14b726f2f24d8862feeb95c9e8a44";
const SOURCE_UNAVAILABLE_EXIT = 2;

const selfTestLocalHashBypass = process.argv.includes("--self-test-local-hash-bypass");

try {
  const localRaw = await readFile(LOCAL_FIXTURE_PATH, "utf8");
  const canonicalRaw = await fetchCanonicalFixture();
  const canonicalSha = sha256(canonicalRaw);
  if (canonicalSha !== CANONICAL_FIXTURE_SHA256) {
    console.error(
      `canonical-source changed unexpectedly: ${CANONICAL_FIXTURE_URL}\n` +
        `got sha256=${canonicalSha}, want sha256=${CANONICAL_FIXTURE_SHA256}`,
    );
    process.exit(1);
  }

  if (selfTestLocalHashBypass) {
    const tamperedRaw = localRaw.replace('"action": "deploy"', '"action": "status"');
    if (tamperedRaw === localRaw) {
      console.error("self-test setup failed: fixture mutation did not change local bytes");
      process.exit(1);
    }
    const tamperedSha = sha256(tamperedRaw);
    if (tamperedRaw === canonicalRaw) {
      console.error("self-test failed: tampered local fixture still matched canonical source");
      process.exit(1);
    }
    console.log(
      "PASS: canonical-source check catches a mutated local fixture even if a local hash is recomputed " +
        `(tampered local sha256=${tamperedSha}, canonical sha256=${canonicalSha})`,
    );
    process.exit(0);
  }

  const localSha = sha256(localRaw);
  if (localRaw !== canonicalRaw) {
    console.error(
      `NodeCommand fixture mismatch against canonical source ${CANONICAL_FIXTURE_URL}\n` +
        `local sha256=${localSha}\ncanonical sha256=${canonicalSha}`,
    );
    process.exit(1);
  }
  console.log(
    `PASS: local NodeCommand fixture matches ${CANONICAL_FIXTURE_URL} ` +
      `(sha256=${localSha})`,
  );
} catch (error) {
  if (error instanceof SourceUnavailableError) {
    console.error(`CANONICAL_SOURCE_UNAVAILABLE: ${error.message}`);
    process.exit(SOURCE_UNAVAILABLE_EXIT);
  }
  throw error;
}

async function fetchCanonicalFixture() {
  let response;
  try {
    response = await fetch(CANONICAL_FIXTURE_URL, { signal: AbortSignal.timeout(15_000) });
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

class SourceUnavailableError extends Error {}
