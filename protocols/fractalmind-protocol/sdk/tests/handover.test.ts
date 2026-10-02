import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bytesToHex,
  handoverAcceptanceSigningBytes,
  handoverProposalHash,
  verifyHandoverAcceptanceSignature,
  assertFreshHandoverAcceptance,
  type HandoverAcceptance,
} from "../src/index.js";
const vector = JSON.parse(
  await readFile(
    new URL(
      "../../../../runtime/fractalmind-envd/internal/nodecommand/testdata/handover-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as { acceptance: HandoverAcceptance; bytes: string; proposalHash: string };

test("Go BCS Host acceptance and signature verified independently by the SDK", async () => {
  const a = structuredClone(vector.acceptance);
  assert.equal(
    Buffer.from(handoverAcceptanceSigningBytes(a)).toString("base64"),
    vector.bytes,
  );
  assert.equal(
    bytesToHex(handoverProposalHash(a.proposal)),
    vector.proposalHash,
  );
  await verifyHandoverAcceptanceSignature(a, a.host_address);
  assertFreshHandoverAcceptance(a, a.observed_at_ms, a.proposal);
  assert.throws(
    () =>
      assertFreshHandoverAcceptance(
        a,
        a.proposal.review_expires_at_ms,
        a.proposal,
      ),
    /expired/,
  );
  assert.throws(
    () => assertFreshHandoverAcceptance(a, a.observed_at_ms - 1, a.proposal),
    /expired/,
  );
  const changed = structuredClone(a.proposal);
  changed.budget_limit = "11";
  assert.throws(
    () => assertFreshHandoverAcceptance(a, a.observed_at_ms, changed),
    /changed/,
  );
  // Signature verification authenticates historical evidence, even after expiry.
  await verifyHandoverAcceptanceSignature(a, a.host_address);
  assert.equal(
    a.proposal.review_expires_at_ms,
    vector.acceptance.proposal.review_expires_at_ms,
  );
});

test("every agreement constraint and source is covered by the Host proof", async () => {
  const mutations: Array<(a: HandoverAcceptance) => void> = [
    (a) => {
      a.execution_id = a.human_id;
    },
    (a) => {
      a.organization_id = a.human_id;
    },
    (a) => {
      a.human_id = a.grant_id;
    },
    (a) => {
      a.grant_id = a.human_id;
    },
    (a) => {
      a.membership_id = a.human_id;
    },
    (a) => {
      a.binding_id = a.human_id;
    },
    (a) => {
      a.instance_id = `native-${"a".repeat(64)}`;
    },
    (a) => {
      a.coverage_revision = "3";
    },
    (a) => {
      a.observed_at_ms++;
    },
    (a) => {
      a.proposal.managed_version = "2";
    },
    (a) => {
      a.proposal.okr_version = "2";
    },
    (a) => {
      a.proposal.spec_revision = "2";
    },
    (a) => {
      a.proposal.budget_limit = "11";
    },
    (a) => {
      a.proposal.max_calls = "4";
    },
    (a) => {
      a.proposal.paths["file.write"] = ["other"];
    },
    (a) => {
      a.proposal.workspace_hash = "a".repeat(64);
    },
    (a) => {
      a.proposal.nonce = "b".repeat(64);
    },
    (a) => {
      a.proposal.expires_at_ms++;
    },
    (a) => {
      a.proposal.review_expires_at_ms++;
    },
  ];
  for (const mutate of mutations) {
    const a = structuredClone(vector.acceptance);
    mutate(a);
    await assert.rejects(
      verifyHandoverAcceptanceSignature(a, vector.acceptance.host_address),
    );
  }
  await assert.rejects(
    verifyHandoverAcceptanceSignature(
      vector.acceptance,
      vector.acceptance.human_id,
    ),
    /Host mismatch/,
  );
});

test("canonical handover fields reject unsafe numbers, aliases and malformed identities", () => {
  const mutations: Array<(a: HandoverAcceptance) => void> = [
    (a) => {
      a.proposal.managed_version = "01";
    },
    (a) => {
      a.proposal.max_calls = "1001";
    },
    (a) => {
      a.proposal.budget_limit = "18446744073709551616";
    },
    (a) => {
      a.proposal.managed_agent_id = "0x6";
    },
    (a) => {
      a.proposal.workspace_hash = "E".repeat(64);
    },
    (a) => {
      a.proposal.paths["file.write"] = [".", "."];
    },
    (a) => {
      a.proposal.expires_at_ms = Number.MAX_SAFE_INTEGER + 1;
    },
    (a) => {
      a.coverage_revision = "0";
    },
    (a) => {
      a.observed_at_ms = a.proposal.review_expires_at_ms;
    },
    (a) => {
      a.instance_id = "files";
    },
  ];
  for (const mutate of mutations) {
    const a = structuredClone(vector.acceptance);
    mutate(a);
    assert.throws(() => handoverAcceptanceSigningBytes(a));
  }
});
