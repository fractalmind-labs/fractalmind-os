import assert from "node:assert/strict";
import test from "node:test";
import { DEVICE_ACTIONS } from "@fractalmind-labs/fractalmind-sdk";
import {
  addedOrganizationId,
  isRootGrant,
  organizationKind,
  restrictedDevices,
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
  const organizations = [{ name: "已有组织" }];
  assert.deepEqual(validateOrganization({ name: "  已有组织  ", description: "  简介  " }, organizations as never), {
    ok: true,
    name: "已有组织",
    description: "简介",
    duplicate: true,
  });
  assert.deepEqual(validateOrganization({ name: " ", description: "" }, organizations as never), {
    ok: false,
    code: "invalid_name",
  });
  assert.deepEqual(validateOrganization({ name: "😀".repeat(65), description: "" }, organizations as never), {
    ok: false,
    code: "invalid_name",
  });
  assert.deepEqual(validateOrganization({ name: "组织", description: "x".repeat(281) }, organizations as never), {
    ok: false,
    code: "invalid_description",
  });
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
