import assert from "node:assert/strict";
import { test } from "node:test";
import {
  fetchCanonicalFixture,
  main,
  SourceUnavailableError,
  SOURCE_UNAVAILABLE_EXIT,
} from "./verify-node-command-canonical-source.mjs";

test("canonical source fetch throw becomes SourceUnavailableError", async () => {
  await assert.rejects(
    () => fetchCanonicalFixture(async () => {
      throw new Error("offline sentinel");
    }),
    (error) => error instanceof SourceUnavailableError && /offline sentinel/.test(error.message),
  );
});

test("canonical source HTTP 503 becomes SourceUnavailableError", async () => {
  await assert.rejects(
    () => fetchCanonicalFixture(async () => ({ ok: false, status: 503, text: async () => "" })),
    (error) => error instanceof SourceUnavailableError && /HTTP 503/.test(error.message),
  );
});

test("CLI contract exits 2 and prints CANONICAL_SOURCE_UNAVAILABLE for fetch throw", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("offline sentinel");
  };
  try {
    const io = captureProcessIO();
    await main(["node", "script"], io);
    assert.equal(io.exitCode, SOURCE_UNAVAILABLE_EXIT);
    assert.match(io.stderrText, /^CANONICAL_SOURCE_UNAVAILABLE: /);
    assert.match(io.stderrText, /offline sentinel/);
    assert.equal(io.stdoutText, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CLI contract exits 2 and prints CANONICAL_SOURCE_UNAVAILABLE for HTTP non-OK", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503, text: async () => "" });
  try {
    const io = captureProcessIO();
    await main(["node", "script"], io);
    assert.equal(io.exitCode, SOURCE_UNAVAILABLE_EXIT);
    assert.match(io.stderrText, /^CANONICAL_SOURCE_UNAVAILABLE: /);
    assert.match(io.stderrText, /HTTP 503/);
    assert.equal(io.stdoutText, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CLI contract exits 1 for canonical byte or SHA mismatch", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => "{\"changed\":true}\n" });
  try {
    const io = captureProcessIO();
    await main(["node", "script"], io);
    assert.equal(io.exitCode, 1);
    assert.match(io.stderrText, /canonical-source changed unexpectedly/);
    assert.doesNotMatch(io.stderrText, /CANONICAL_SOURCE_UNAVAILABLE/);
    assert.equal(io.stdoutText, "");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function captureProcessIO() {
  const capture = {
    stdoutText: "",
    stderrText: "",
    exitCode: undefined,
    stdout: {
      write(value) {
        capture.stdoutText += value;
      },
    },
    stderr: {
      write(value) {
        capture.stderrText += value;
      },
    },
    exit(code) {
      capture.exitCode = code;
    },
  };
  return capture;
}
