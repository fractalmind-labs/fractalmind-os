import test from "node:test";
import assert from "node:assert/strict";
import { parseHostProbes } from "../src/host-health";

test("Host probe results are read only in the shape envd's health probes return", () => {
  const probes = parseHostProbes({
    source: "host-health-probes",
    probes: [
      {
        name: "ornith-verify",
        ok: true,
        exit_code: 0,
        stdout: '{"verified": true}',
        stderr: "",
        truncated: false,
        duration_ms: 812,
      },
      {
        name: "disk",
        ok: false,
        exit_code: 2,
        stdout: "",
        stderr: "low",
        truncated: false,
        duration_ms: 5,
      },
    ],
  });
  assert.deepEqual(
    probes?.map((p) => [p.name, p.ok, p.exitCode]),
    [
      ["ornith-verify", true, 0],
      ["disk", false, 2],
    ],
  );
  for (const bad of [
    null,
    { probes: [] },
    { source: "agent-manager", probes: [] },
    { source: "host-health-probes", probes: [{ name: "x", ok: "yes" }] },
    {
      source: "host-health-probes",
      probes: [
        {
          name: "x",
          ok: true,
          exit_code: 1.5,
          stdout: "",
          stderr: "",
          truncated: false,
          duration_ms: 1,
        },
      ],
    },
  ])
    assert.equal(parseHostProbes(bad), null);
});
