import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import HostAccess from "../src/HostAccess";
import { hostAccessFixture } from "./helpers/host-access-fixture";
const text = (node: ReactTestInstance): string =>
  node.children.map((x) => (typeof x === "string" ? x : text(x))).join("");
async function setup(ctx: test.TestContext) {
  const storage = new Map<string, string>();
  ctx.mock.method(globalThis, "setInterval", (() => 0) as any);
  ctx.mock.method(globalThis, "clearInterval", (() => {}) as any);
  const oldIndexedDB = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open: () => {
        throw new Error("Unexpected journal read in mocked preflight");
      },
    },
  });
  const oldTauri = Object.getOwnPropertyDescriptor(globalThis, "isTauri");
  Object.defineProperty(globalThis, "isTauri", {
    configurable: true,
    value: true,
  });
  const oldStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
      removeItem: (k: string) => storage.delete(k),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { __TAURI_INTERNALS__: {} },
  });
  const fixture = hostAccessFixture();
  let view: ReactTestRenderer;
  ctx.after(async () => {
    await act(async () => view.unmount());
    fixture.restore();
    if (oldIndexedDB)
      Object.defineProperty(globalThis, "indexedDB", oldIndexedDB);
    else delete (globalThis as any).indexedDB;
    if (oldTauri) Object.defineProperty(globalThis, "isTauri", oldTauri);
    else delete (globalThis as any).isTauri;
    if (oldStorage)
      Object.defineProperty(globalThis, "localStorage", oldStorage);
    else delete (globalThis as any).localStorage;
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else delete (globalThis as any).window;
  });
  await act(async () => {
    view = create(
      createElement(HostAccess, {
        ...fixture,
        t: (zh: string) => zh,
        request: { kind: "invite", n: 1 },
      }),
    );
  });
  const button = (name: string) =>
    view!.root.findAllByType("button").find((b) => text(b) === name)!;
  const click = async (name: string) => {
    const b = button(name);
    assert.ok(b, name);
    assert.ok(!b.props.disabled, name);
    await act(async () => {
      b.props.onClick();
    });
  };
  return { ...fixture, view: view!, button, click };
}
test("Host access starts compact, skips history, and keeps immediate progress through slow generation", async (ctx) => {
  const f = await setup(ctx);
  assert.ok(f.button("生成接入串"));
  assert.equal(f.reads.includes(f.inviteId), false);
  const advanced = f.view.root
    .findAllByType("details")
    .find((d) => d.props.className === "panel")!;
  assert.equal(advanced.props.open, false);
  const resume = f.pause();
  await f.click("生成接入串");
  assert.match(text(f.view.root.findByProps({ role: "status" })), /核验权限/);
  assert.ok(f.button("正在处理…").props.disabled);
  // Even a programmatic repeat must not create a second request.
  await act(async () => {
    f.button("正在处理…").props.onClick();
  });
  assert.equal(f.counts().prepares, 1);
  await act(async () => {
    resume();
  });
  assert.equal(f.counts().submissions, 1);
  assert.ok(
    f.view.root
      .findByProps({ "aria-label": "Host 接入串" })
      .props.value.startsWith("FMJ1:"),
  );
  assert.equal(f.counts().changed, 1);
});
test("Fees above the quick limit require a visible confirmation before a single submission", async (ctx) => {
  const f = await setup(ctx);
  f.mode("expensive");
  await f.click("生成接入串");
  assert.ok(f.view.root.findByProps({ "aria-label": "费用确认" }));
  assert.equal(f.counts().submissions, 0);
  await f.click("确认支付并提交");
  assert.equal(f.counts().submissions, 1);
});
test("A failed preflight shows a useful alert and a recovery action without resubmitting", async (ctx) => {
  const f = await setup(ctx);
  f.mode("error");
  await f.click("生成接入串");
  assert.match(
    text(f.view.root.findByProps({ role: "alert" })),
    /网络读取失败/,
  );
  assert.ok(f.button("查询上次操作"));
  assert.ok(f.button("开始新操作").props.disabled);
  assert.equal(f.counts().submissions, 0);
});
test("An unknown original outcome permits querying, and prevents a fresh generation", async (ctx) => {
  const f = await setup(ctx);
  f.mode("unknown");
  await f.click("生成接入串");
  assert.match(text(f.view.root), /结果未知，仅查询原交易/);
  assert.ok(f.button("查询原交易"));
  assert.ok(f.button("开始新操作").props.disabled);
  assert.equal(f.button("生成接入串"), undefined);
  assert.equal(f.counts().submissions, 0);
});
test("Opening Advanced loads invitation history only on demand", async (ctx) => {
  const f = await setup(ctx);
  assert.equal(f.reads.includes(f.inviteId), false);
  const advanced = f.view.root
    .findAllByType("details")
    .find((d) => d.props.className === "panel")!;
  await act(async () => {
    advanced.props.onToggle({ currentTarget: { open: true } });
  });
  assert.equal(f.reads.includes(f.inviteId), true);
});

test("Unavailable durable storage shows a specific error before any submission", async (ctx) => {
  const f = await setup(ctx);
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: undefined,
  });
  await f.click("生成接入串");
  assert.match(
    text(f.view.root.findByProps({ role: "alert" })),
    /无法读取本机交易记录/,
  );
  assert.deepEqual(f.counts(), { prepares: 0, submissions: 0, changed: 0 });
});
test("A failed attempt save cannot proceed to quote or submit", async (ctx) => {
  const f = await setup(ctx);
  ctx.mock.method(localStorage, "setItem", () => {
    throw new Error("Storage blocked");
  });
  await f.click("生成接入串");
  assert.match(
    text(f.view.root.findByProps({ role: "alert" })),
    /无法读取本机交易记录/,
  );
  assert.deepEqual(f.counts(), { prepares: 0, submissions: 0, changed: 0 });
});
