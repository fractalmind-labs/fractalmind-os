import assert from "node:assert/strict";
import test from "node:test";
import { DEVICE_ACTIONS, TransactionPreflightError } from "@fractalmind-labs/fractalmind-sdk";
import {
  addedOrganizationId,
  isRootGrant,
  OrganizationCreation,
  organizationIdsCreatedBy,
  organizationCreationFailure,
  organizationNameAvailability,
  organizationOutcomeFailure,
  organizationKind,
  recoverMissingOrganizationJournal,
  resolveAddedOrganization,
  restrictedDevices,
  shouldClearOrganizationAttemptOnClose,
  validateOrganization,
} from "../src/organization-create";

const currentGeneration = "7";
const now = 1_000n;
const grant = (patch: Record<string, unknown> = {}) => ({
  id: "0x1",
  device: "0xdevice",
  org_scope: null,
  actions: [DEVICE_ACTIONS.read, DEVICE_ACTIONS.approve],
  revoked: false,
  generation: currentGeneration,
  expires_at_ms: "1001",
  ...patch,
});

test("only a current unscoped approving grant is a root authorization", () => {
  assert.equal(isRootGrant(grant() as never, currentGeneration as never, now), true);
  assert.equal(isRootGrant(grant({ org_scope: "0xscope" }) as never, currentGeneration as never, now), false);
  assert.equal(isRootGrant(grant({ actions: [DEVICE_ACTIONS.read] }) as never, currentGeneration as never, now), false);
  assert.equal(isRootGrant(grant({ revoked: true }) as never, currentGeneration as never, now), false);
  assert.equal(isRootGrant(grant({ expires_at_ms: "1000" }) as never, currentGeneration as never, now), false);
  assert.equal(isRootGrant(grant({ generation: "6" }) as never, currentGeneration as never, now), false);
});

test("organization name uses trimmed Unicode code points and description is optional", () => {
  assert.deepEqual(validateOrganization({ name: "  已有组织  ", description: "  简介  " }), {
    ok: true,
    name: "已有组织",
    description: "简介",
  });
  assert.deepEqual(validateOrganization({ name: " ", description: "" }), {
    ok: false,
    code: "invalid_name",
  });
  assert.deepEqual(validateOrganization({ name: "😀".repeat(65), description: "" }), {
    ok: false,
    code: "invalid_name",
  });
  assert.deepEqual(validateOrganization({ name: "组织", description: "x".repeat(281) }), {
    ok: false,
    code: "invalid_description",
  });
});

test("organization names are checked in the global registry, including own names and lookup failures", async () => {
  const other = "0x" + "1".repeat(64);
  const own = "0x" + "2".repeat(64);
  const lookup = (result: string | null | Error) => async (_chain: unknown, name: string) => {
    assert.equal(name, "Shared name");
    if (result instanceof Error) throw result;
    return result;
  };
  assert.deepEqual(
    await organizationNameAvailability({} as never, "Shared name", [{ objectId: own }] as never, lookup(other)),
    { state: "taken", name: "Shared name", organizationId: other, own: false },
  );
  assert.deepEqual(
    await organizationNameAvailability({} as never, "Shared name", [{ objectId: own }] as never, lookup(own)),
    { state: "taken", name: "Shared name", organizationId: own, own: true },
  );
  assert.deepEqual(
    await organizationNameAvailability({} as never, "Shared name", [], lookup(null)),
    { state: "available", name: "Shared name" },
  );
  assert.deepEqual(
    await organizationNameAvailability({} as never, "Shared name", [], lookup(new Error("offline"))),
    { state: "unavailable", name: "Shared name" },
  );
});

test("only the typed organization 3002 failure becomes a retryable global-name error", () => {
  const pkg = "0x" + "4".repeat(64);
  const cause = {
    $kind: "MoveAbort",
    MoveAbort: {
      abortCode: "3002",
      location: { package: pkg, module: "organization", functionName: "new_organization" },
    },
  };
  assert.equal(
    organizationCreationFailure(
      new TransactionPreflightError("simulation_failed", "rejected", { cause }),
      pkg,
    ),
    "organization_name_taken",
  );
  assert.equal(
    organizationCreationFailure(
      new TransactionPreflightError("simulation_failed", "rejected", {
        cause: { ...cause, MoveAbort: { ...cause.MoveAbort, location: { ...cause.MoveAbort.location, module: "identity" } } },
      }),
      pkg,
    ),
    "simulation_failed",
  );
  assert.equal(
    organizationOutcomeFailure({ status: "failed", transaction: { status: { error: cause } } } as never, pkg),
    "organization_name_taken",
  );
});

test("organization labels distinguish child, first personal, and later organizations", () => {
  const personal = { objectId: "0xpersonal", depth: "0" };
  const additional = { objectId: "0xadditional", depth: "0" };
  const child = { objectId: "0xchild", depth: "1" };
  const organizations = [personal, additional, child];
  assert.equal(organizationKind(personal as never, organizations as never), "personal");
  assert.equal(organizationKind(additional as never, organizations as never), "organization");
  assert.equal(organizationKind(child as never, organizations as never), "suborganization");
});

test("the post-transaction directory difference identifies exactly one new organization", () => {
  assert.equal(
    addedOrganizationId(["0xpersonal"], [{ objectId: "0xpersonal" }, { objectId: "0xnew" }] as never),
    "0xnew",
  );
  assert.equal(addedOrganizationId(["0xpersonal"], [{ objectId: "0xpersonal" }] as never), null);
  assert.equal(
    addedOrganizationId(["0xpersonal"], [{ objectId: "0xpersonal" }, { objectId: "0xa" }, { objectId: "0xb" }] as never),
    null,
  );
});

test("journal miss with no new organization clears the attempt and returns the form with a neutral notice", () => {
  assert.deepEqual(
    recoverMissingOrganizationJournal(
      ["0xpersonal"],
      [{ objectId: "0xpersonal", name: "Personal" }] as never,
    ),
    {
      state: "not_submitted",
      clearAttempt: true,
      phase: "form",
      notice: "not_submitted",
    },
  );
});

test("journal miss with one new organization reconciles it without submitting another transaction", () => {
  assert.deepEqual(
    recoverMissingOrganizationJournal(
      ["0xpersonal"],
      [
        { objectId: "0xpersonal", name: "Personal" },
        { objectId: "0xnew", name: "New organization" },
      ] as never,
    ),
    { state: "created", organizationId: "0xnew" },
  );
});

test("journal miss with more than one new organization clears the unsubmitted locator instead of guessing", () => {
  assert.deepEqual(
    recoverMissingOrganizationJournal(
      ["0xpersonal"],
      [
        { objectId: "0xpersonal", name: "Personal" },
        { objectId: "0xfirst", name: "First" },
        { objectId: "0xsecond", name: "Second" },
      ] as never,
    ),
    {
      state: "not_submitted",
      clearAttempt: true,
      phase: "form",
      notice: "not_submitted",
    },
  );
});

test("a confirmed receipt with no readable organization remains retryable instead of becoming a false success", () => {
  const outcome = {
    status: "confirmed",
    digest: "digest",
    transaction: { effects: { changedObjects: [] }, objectTypes: {} },
  } as never;
  assert.deepEqual(
    resolveAddedOrganization(["0xpersonal"], [{ objectId: "0xpersonal", name: "Personal" }] as never, { outcome }),
    { state: "not_visible" },
  );
});

test("a confirmed indexing recheck only rereads the Human directory until its organization is visible", async () => {
  let reads = 0;
  const creation = new OrganizationCreation(
    {
      human: async () => {
        reads++;
        return {
          organizations:
            reads === 1
              ? [{ objectId: "0xpersonal", name: "Personal" }]
              : [
                  { objectId: "0xpersonal", name: "Personal" },
                  { objectId: "0xnew", name: "New organization" },
                ],
          } as never;
      },
      sdk: { client: { client: {} } },
      profile: { network: "localnet" },
    } as never,
    {} as never,
    {} as never,
  );
  const result = await creation.awaitCreated(["0xpersonal"], {
    outcome: { status: "confirmed", digest: "digest" } as never,
    attempts: 2,
    delayMs: 0,
  });
  assert.equal(result.state, "created");
  if (result.state === "created") assert.equal(result.organizationId, "0xnew");
  assert.equal(reads, 2);
});

test("two new organizations choose the confirmed receipt's Organization write, then offer a list rather than hanging", () => {
  const organizations = [
    { objectId: "0xpersonal", name: "Personal" },
    { objectId: "0xfirst", name: "First" },
    { objectId: "0xsecond", name: "Second" },
  ] as never;
  const outcome = {
    digest: "confirmed-digest",
    transaction: {
      digest: "confirmed-digest",
      effects: {
        changedObjects: [
          { objectId: "0xsecond", outputState: "ObjectWrite" },
          { objectId: "0xother", outputState: "ObjectWrite" },
        ],
      },
      objectTypes: {
        "0xsecond": "0xpackage::organization::Organization",
        "0xother": "0xpackage::identity::DeviceGrant",
      },
    },
  } as never;
  assert.deepEqual(organizationIdsCreatedBy(outcome), ["0xsecond"]);
  assert.deepEqual(
    resolveAddedOrganization(["0xpersonal"], organizations, { outcome }),
    { state: "created", organizationId: "0xsecond" },
  );
  assert.deepEqual(
    resolveAddedOrganization(["0xpersonal"], organizations, {
      outcome: {
        digest: "confirmed-digest",
        transaction: {
          digest: "a-different-receipt",
          effects: { changedObjects: [{ objectId: "0xsecond", outputState: "ObjectWrite" }] },
          objectTypes: { "0xsecond": "0xpackage::organization::Organization" },
        },
      } as never,
    }),
    { state: "choose", organizationIds: ["0xfirst", "0xsecond"] },
  );
  assert.deepEqual(
    resolveAddedOrganization(["0xpersonal"], organizations),
    { state: "choose", organizationIds: ["0xfirst", "0xsecond"] },
  );
  assert.deepEqual(
    resolveAddedOrganization(["0xpersonal"], organizations, { name: "Second" }),
    { state: "created", organizationId: "0xsecond" },
  );
});

test("closing a quote before signing clears its pre-submit attempt", () => {
  assert.equal(shouldClearOrganizationAttemptOnClose("quoting"), true);
  assert.equal(shouldClearOrganizationAttemptOnClose("ready"), true);
  assert.equal(shouldClearOrganizationAttemptOnClose("signing"), false);
  assert.equal(shouldClearOrganizationAttemptOnClose("unknown"), false);
});

test("only valid devices scoped to another organization are listed as restricted", () => {
  const devices = restrictedDevices(
    [
      grant({ id: "0x1", device: "0xscoped", org_scope: "0xother" }),
      grant({ id: "0x2", device: "0xscoped", org_scope: "0xthird" }),
      grant({ id: "0x3", device: "0xcurrent", org_scope: "0xnew" }),
      grant({ id: "0x4", device: "0xold", org_scope: "0xother", generation: "6" }),
      grant({ id: "0x5", device: "0xrevoked", org_scope: "0xother", revoked: true }),
    ] as never,
    currentGeneration as never,
    now,
    "0xnew",
  );
  assert.deepEqual(devices.map((device) => device.device), ["0xscoped"]);
});
