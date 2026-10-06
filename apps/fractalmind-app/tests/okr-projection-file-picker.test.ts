import test from "node:test";
import assert from "node:assert/strict";
import { OkrProjectionFilePicker } from "../src/okr-projection-file-picker";

const scope = JSON.stringify(["localnet", "chain", "human", "org", "okr", "device"]);
const file = { name: "OKR.md", text: "private proposal" };

test("a system picker may return before or after visibility without reading in background or consuming twice", () => {
  for (const returnedWhileHidden of [true, false]) {
    const picker = new OkrProjectionFilePicker<typeof file>();
    picker.begin(scope);
    picker.suspend();
    if (!returnedWhileHidden) assert.equal(picker.take(scope, true), null);
    picker.select(scope, file);
    assert.equal(picker.take(scope, false), null);
    const selected = picker.take(scope, true)!;
    assert.equal(selected.file, file);
    assert.equal(picker.current(selected, scope), true);
    assert.equal(picker.take(scope, true), null);
    picker.select(scope, file);
    assert.equal(picker.take(scope, true), null);
    picker.finish(selected);
    assert.equal(picker.current(selected, scope), false);
  }
});

test("cancelled or unsolicited file events cannot resume a private session", () => {
  const picker = new OkrProjectionFilePicker<typeof file>();
  picker.select(scope, file);
  assert.equal(picker.take(scope, true), null);
  picker.begin(scope);
  picker.suspend();
  picker.cancel();
  picker.select(scope, file);
  assert.equal(picker.take(scope, true), null);
});

test("returning without a cancel event or a selected file does not cause an import", () => {
  const picker = new OkrProjectionFilePicker<typeof file>();
  picker.begin(scope);
  picker.suspend();
  assert.equal(picker.take(scope, true), null);
  assert.equal(picker.take(scope, true), null);
  // Explicitly reopening the dialog cancels the outstanding public intent.
  picker.cancel();
  picker.select(scope, file);
  assert.equal(picker.take(scope, true), null);
});

test("chain, identity, organization, OKR or device changes invalidate selection and asynchronous completion", () => {
  for (let index = 0; index < 6; index++) {
    const fields = JSON.parse(scope);
    fields[index] = "changed";
    const other = JSON.stringify(fields);
    const picker = new OkrProjectionFilePicker<typeof file>();
    picker.begin(scope);
    picker.select(scope, file);
    assert.equal(picker.take(other, true), null);
    assert.equal(picker.take(scope, true), null);
    picker.begin(scope);
    picker.select(scope, file);
    const selected = picker.take(scope, true)!;
    assert.equal(picker.current(selected, other), false);
  }
});

test("a second background, explicit close or unmount invalidates an in-flight fresh read", () => {
  for (const stop of ["background", "close", "unmount"]) {
    const picker = new OkrProjectionFilePicker<typeof file>();
    picker.begin(scope);
    picker.select(scope, file);
    const selected = picker.take(scope, true)!;
    if (stop === "background") picker.suspend();
    else picker.cancel();
    assert.equal(picker.current(selected, scope), false);
    assert.equal(picker.take(scope, true), null);
  }
});

test("a late completion cannot clear a subsequent user selection", () => {
  const picker = new OkrProjectionFilePicker<typeof file>();
  picker.begin(scope);
  picker.select(scope, file);
  const old = picker.take(scope, true)!;
  picker.begin(scope);
  picker.select(scope, file);
  const current = picker.take(scope, true)!;
  picker.finish(old);
  assert.equal(picker.current(old, scope), false);
  assert.equal(picker.current(current, scope), true);
});
