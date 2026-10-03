import { readFile, realpath, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

// Keep generated Tauri Android projects reproducible after init/build. This
// overlay owns only MainActivity; it does not alter manifest, SDK or signing.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(
  await readFile(join(root, "src-tauri/tauri.conf.json"), "utf8"),
);
if (config.identifier !== "org.fractalmind.desktop")
  throw new Error(
    "Android application identifier changed; review platform overlay",
  );
const generated = await realpath(join(root, "src-tauri/gen/android"));
const activity = join(
  generated,
  "app/src/main/java/org/fractalmind/desktop/MainActivity.kt",
);
const actual = await realpath(activity);
const inside = relative(generated, actual);
if (inside.startsWith(`..${sep}`) || inside === "..")
  throw new Error("Android activity must remain in the generated project");
const current = await readFile(actual, "utf8");
const standard = `package org.fractalmind.desktop

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }
}`;
const managed = "// FractalMind managed Android activity;";
if (current.trim() !== standard && !current.startsWith(managed))
  throw new Error("Unexpected Android activity; review before replacing it");
const source = await readFile(
  join(root, "src-tauri/platform/android/MainActivity.kt"),
  "utf8",
);
if (source !== current) await writeFile(actual, source);
console.log("Applied FractalMind Android system-bar appearance and insets");
