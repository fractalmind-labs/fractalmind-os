// Bundles Agent ROMs and the skills they install (#67) into
// src-tauri/resources/agent-assets: catalog.json, roms/<id>/templates and
// skills/<name>. Sources are this repository's roms/agent-os-roms and skills;
// a skill this repository does not contain is listed as unavailable.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(app, "../..");
const romsDir = join(repo, "roms/agent-os-roms/roms");
const out = join(app, "src-tauri/resources/agent-assets");
// The runtime every Agent needs, whether or not its ROM lists it.
export const RUNTIME_SKILL = "agent-manager";

/** Only the manifest fields the App shows and installs (the manifests are plain YAML). */
export function parseManifest(text) {
  const scalar = (key) => {
    const m = text.match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"));
    if (!m) return "";
    let v = m[1].trim();
    if (v === ">-" || v === ">" || v === "|") {
      const rest = text.slice(m.index + m[0].length + 1).split("\n");
      const lines = [];
      for (const line of rest) {
        if (!/^\s+\S/.test(line)) break;
        lines.push(line.trim());
      }
      return lines.join(" ");
    }
    return v.replace(/^["']|["']$/g, "");
  };
  const block = (key, indent = "") => {
    const m = text.match(new RegExp(`^${indent}${key}:\\n((?:${indent}[ ]+.*\\n|\\s*\\n)+)`, "m"));
    return m ? m[1] : "";
  };
  const list = (body) => [...body.matchAll(/^\s+- (\S.*)$/gm)].map((x) => x[1].trim());
  const skills = (key) => {
    const body = block(key);
    const items = [];
    for (const chunk of body.split(/^  - /m).slice(1)) {
      const name = (chunk.match(/^(?:name:\s*)?([\w-]+)\s*$/m) || [])[1];
      if (!name) continue;
      const source = {
        type: (chunk.match(/type:\s*(\S+)/) || [])[1] || null,
        repo: (chunk.match(/repo:\s*(\S+)/) || [])[1] || null,
        path: (chunk.match(/path:\s*(\S+)/) || [])[1] || null,
      };
      const description = (chunk.match(/description:\s*(.+)$/m) || [])[1] || "";
      items.push({ name, source, description: description.trim() });
    }
    return items;
  };
  const install = block("install_boundary");
  return {
    id: scalar("rom_name"),
    family: scalar("rom_family"),
    version: scalar("rom_version"),
    compat: scalar("compatibility_status"),
    description: scalar("description"),
    files: list((install.match(/creates_files:\n((?:\s+- .*\n)+)/) || [])[1] || ""),
    directories: list((install.match(/creates_directories:\n((?:\s+- .*\n)+)/) || [])[1] || ""),
    included: skills("included_skills"),
    optional: skills("optional_skills"),
  };
}

/** SKILL.md frontmatter name → directory, for skills listed by name only. */
function skillIndex() {
  const index = new Map();
  const walk = (dir, depth) => {
    if (depth > 5) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules" || e.name === "registry") continue;
      const p = join(dir, e.name);
      const md = join(p, "SKILL.md");
      if (existsSync(md)) {
        const name = (readFileSync(md, "utf8").match(/^name:\s*([\w-]+)/m) || [])[1];
        if (name && !index.has(name)) index.set(name, p);
      }
      walk(p, depth + 1);
    }
  };
  walk(join(repo, "skills"), 0);
  return index;
}

function copy(from, to) {
  cpSync(from, to, {
    recursive: true,
    filter: (src) => !/(__pycache__|\.DS_Store|\/tests?(\/|$)|\.pyc$)/.test(src),
  });
}

function build() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, "skills"), { recursive: true });
  const index = skillIndex();
  const installed = new Map();
  const resolveSkill = (rom, skill) => {
    if (skill.source.type === "embedded") {
      const p = join(romsDir, rom, "templates", skill.source.path);
      return existsSync(join(p, "SKILL.md")) ? { embedded: skill.source.path } : null;
    }
    const local =
      skill.source.type === "git" && /fractalmind-os(\.git)?$/.test(skill.source.repo || "") && skill.source.path
        ? join(repo, skill.source.path)
        : index.get(skill.name);
    if (!local || !existsSync(join(local, "SKILL.md"))) return null;
    if (!installed.has(skill.name)) {
      copy(local, join(out, "skills", skill.name));
      installed.set(skill.name, local);
    }
    return { bundled: skill.name };
  };
  resolveSkill("", { name: RUNTIME_SKILL, source: {} });
  const roms = [];
  for (const id of readdirSync(romsDir).sort()) {
    const manifest = join(romsDir, id, "manifest.yaml");
    if (!existsSync(manifest)) continue;
    const m = parseManifest(readFileSync(manifest, "utf8"));
    if (m.id !== id) throw new Error(`${id}: rom_name ${m.id} does not match its folder`);
    copy(join(romsDir, id, "templates"), join(out, "roms", id, "templates"));
    const entry = (s) => {
      const where = resolveSkill(id, s);
      return { name: s.name, description: s.description, available: Boolean(where), ...(where || {}) };
    };
    roms.push({
      id: m.id, family: m.family, version: m.version, compat: m.compat, description: m.description,
      files: m.files, directories: m.directories,
      included: m.included.map(entry), optional: m.optional.map(entry),
    });
  }
  writeFileSync(join(out, "catalog.json"), JSON.stringify({ format: 1, runtimeSkill: RUNTIME_SKILL, roms }, null, 2) + "\n");
  return roms;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const roms = build();
  const missing = roms.flatMap((r) => r.included.concat(r.optional).filter((s) => !s.available).map((s) => `${r.id}:${s.name}`));
  console.log(`agent assets: ${roms.length} ROMs → ${out}${missing.length ? ` (unavailable skills: ${missing.join(", ")})` : ""}`);
  const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((n, e) => n + size(join(p, e)), 0) : statSync(p).size);
  console.log(`size: ${(size(out) / 1024).toFixed(0)} KiB`);
}
