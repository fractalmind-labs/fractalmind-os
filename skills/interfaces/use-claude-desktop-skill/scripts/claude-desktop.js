#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const DEFAULT_APP_PATH = "/Applications/Claude.app";
const DEFAULT_EXECUTABLE = path.join(DEFAULT_APP_PATH, "Contents", "MacOS", "Claude");
const DEFAULT_ENDPOINT = "http://127.0.0.1:19334";
const DEFAULT_INBOX = path.join(os.homedir(), ".fractalbot", "claude-desktop-inbox");
const CDP_GUARD = "OeA(process.argv)&&!H2()&&process.exit(1);";

function usage(exitCode = 0) {
  const text = `Usage:
  claude-desktop.js status [--endpoint URL] [--json]
  claude-desktop.js force-cdp [--port 19334] [--try-launch] [--json]
  claude-desktop.js enqueue --message TEXT [--channel NAME] [--chat-id ID] [--inbox PATH]
  claude-desktop.js deliver --message TEXT [--endpoint URL] [--fallback inbox|ui|none] [--submit]

Defaults:
  endpoint: ${DEFAULT_ENDPOINT}
  inbox:    ${DEFAULT_INBOX}
`;
  (exitCode ? console.error : console.log)(text);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    let key = arg.slice(2);
    let value = true;
    if (eq >= 0) {
      key = arg.slice(2, eq);
      value = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      value = argv[++i];
    }
    args[key] = value;
  }
  return args;
}

function output(value, json) {
  if (json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  for (const [key, val] of Object.entries(value)) {
    if (val && typeof val === "object") {
      console.log(`${key}: ${JSON.stringify(val, null, 2)}`);
    } else {
      console.log(`${key}: ${val}`);
    }
  }
}

function fileExists(file) {
  try {
    fs.accessSync(file, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function plistValue(appPath, key) {
  const plist = path.join(appPath, "Contents", "Info.plist");
  if (!fileExists(plist)) return "";
  const res = spawnSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], { encoding: "utf8" });
  return res.status === 0 ? res.stdout.trim() : "";
}

function detectCDPGuard(appPath) {
  const asar = path.join(appPath, "Contents", "Resources", "app.asar");
  if (!fileExists(asar)) {
    return { detected: false, app_asar: asar, error: "app.asar not found" };
  }
  const data = fs.readFileSync(asar);
  const idx = data.indexOf(Buffer.from(CDP_GUARD));
  return {
    detected: idx >= 0,
    app_asar: asar,
    byte_offset: idx >= 0 ? idx : undefined
  };
}

function requestJSON(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https:") ? https : http;
    const req = lib.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          resolve({ ok: false, error: `HTTP ${res.statusCode}: ${body.slice(0, 200)}` });
          return;
        }
        try {
          resolve({ ok: true, value: JSON.parse(body) });
        } catch (error) {
          resolve({ ok: false, error: `invalid JSON: ${error.message}` });
        }
      });
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", (error) => {
      resolve({ ok: false, error: error.message });
    });
  });
}

async function probeCDP(endpoint) {
  endpoint = String(endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, "");
  const version = await requestJSON(`${endpoint}/json/version`);
  if (!version.ok) {
    return { endpoint, available: false, error: version.error };
  }
  const list = await requestJSON(`${endpoint}/json/list`);
  if (!list.ok) {
    return { endpoint, available: false, version: version.value, error: list.error };
  }
  const targets = Array.isArray(list.value) ? list.value : [];
  const debuggableTargets = targets.filter((target) => target.webSocketDebuggerUrl);
  const authenticatedTargets = debuggableTargets.filter(isUsableClaudeTarget);
  const loginTargets = debuggableTargets.filter(isClaudeLoginTarget);
  return {
    endpoint,
    available: debuggableTargets.length > 0,
    deliverable: authenticatedTargets.length > 0,
    readiness: authenticatedTargets.length > 0
      ? "deliverable"
      : loginTargets.length > 0
        ? "login-required"
        : debuggableTargets.length > 0
          ? "no-authenticated-target"
          : "no-debuggable-target",
    version: version.value,
    target_count: targets.length,
    authenticated_target_count: authenticatedTargets.length,
    login_target_count: loginTargets.length,
    targets: targets.map((target) => ({
      type: target.type,
      title: target.title,
      url: target.url,
      webSocketDebuggerUrl: target.webSocketDebuggerUrl
    }))
  };
}

function runningClaudeProcesses() {
  const res = spawnSync("ps", ["-axo", "pid,ppid,command"], { encoding: "utf8" });
  if (res.status !== 0) return [];
  return res.stdout.split(/\r?\n/)
    .filter((line) => line.includes("Claude.app/Contents"))
    .map((line) => line.trim().replace(/\s+/g, " "));
}

async function status(args) {
  const appPath = String(args["app-path"] || DEFAULT_APP_PATH);
  const endpoint = String(args.endpoint || DEFAULT_ENDPOINT);
  const cdp = await probeCDP(endpoint);
  return {
    app_path: appPath,
    installed: fileExists(path.join(appPath, "Contents", "MacOS", "Claude")),
    bundle_id: plistValue(appPath, "CFBundleIdentifier"),
    version: plistValue(appPath, "CFBundleShortVersionString"),
    cdp,
    cdp_auth_guard: detectCDPGuard(appPath),
    running_processes: runningClaudeProcesses()
  };
}

function normalizeEnvelope(args) {
  const text = String(args.message || args.text || "").trim();
  if (!text) throw new Error("--message is required");
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex"),
    received_at: new Date().toISOString(),
    channel: String(args.channel || ""),
    chat_id: String(args["chat-id"] || args.chat_id || ""),
    thread_ts: String(args["thread-ts"] || args.thread_ts || ""),
    user_id: String(args["user-id"] || args.user_id || ""),
    username: String(args.username || ""),
    selected_agent: String(args["selected-agent"] || args.selected_agent || "main"),
    text,
    body_mode: String(args["body-mode"] || args.body_mode || ""),
    body_file: String(args["body-file"] || args.body_file || "")
  };
}

function buildPrompt(envelope) {
  const lines = [];
  lines.push("# FractalBot Inbound Message");
  lines.push("");
  lines.push("Inbound routing context:");
  lines.push(`- channel: ${envelope.channel || "(none)"}`);
  lines.push(`- chat_id: ${envelope.chat_id || "(none)"}`);
  lines.push(`- user_id: ${envelope.user_id || "(none)"}`);
  lines.push(`- username: ${envelope.username || "(none)"}`);
  lines.push(`- selected_agent: ${envelope.selected_agent || "(none)"}`);
  lines.push(`- envelope_id: ${envelope.id}`);
  if (envelope.thread_ts) lines.push(`- thread_ts: ${envelope.thread_ts}`);
  if (envelope.body_mode) lines.push(`- body_mode: ${envelope.body_mode}`);
  if (envelope.body_file) lines.push(`- body_file: ${envelope.body_file}`);
  lines.push("");
  lines.push("Routing instructions:");
  lines.push("- This message was delivered by FractalBot into Claude Desktop.");
  lines.push("- For outbound messaging intent, prefer `use-fractalbot` skill.");
  lines.push("- Effective available skills:");
  lines.push("  - use-fractalbot (.claude/skills/use-fractalbot/SKILL.md)");
  lines.push("- If channel=telegram and recipient is omitted, default to current chat_id.");
  lines.push("- If thread_ts is present, reply in the same thread.");
  lines.push("- Preserve the routing context if an external reply is requested.");
  lines.push("- Do not scrape or export unrelated Claude Desktop history.");
  lines.push("");
  if (envelope.body_mode === "file_pointer" && envelope.body_file) {
    lines.push(`User message body: see file ${envelope.body_file}`);
  } else {
    lines.push("User message:");
    lines.push(envelope.text);
  }
  return lines.join("\n");
}

function writeInbox(inboxPath, envelope, prompt) {
  fs.mkdirSync(inboxPath, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
  const finalPath = path.join(inboxPath, `${stamp}-${envelope.id}.json`);
  const tmpPath = path.join(inboxPath, `.${path.basename(finalPath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, JSON.stringify({ envelope, prompt }, null, 2), { mode: 0o600 });
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

function selectTarget(cdp, selector) {
  const targets = (cdp.targets || []).filter((target) => target.webSocketDebuggerUrl && isUsableClaudeTarget(target));
  if (!targets.length) {
    const loginTargets = (cdp.targets || []).filter((target) => target.webSocketDebuggerUrl && isClaudeLoginTarget(target));
    if (loginTargets.length) {
      throw new Error("CDP has no authenticated Claude chat target; Claude Desktop is on a login page");
    }
    throw new Error("CDP has no authenticated Claude chat target");
  }
  selector = String(selector || "").trim();
  if (selector) {
    const match = targets.find((target) =>
      String(target.title || "").includes(selector) || String(target.url || "").includes(selector)
    );
    if (match) return match;
    throw new Error(`no CDP target matched selector ${JSON.stringify(selector)}`);
  }
  return targets.find((target) => target.type === "page") || targets[0];
}

function isUsableClaudeTarget(target) {
  const url = String(target.url || "").toLowerCase();
  const title = String(target.title || "").toLowerCase();
  if (!url) return false;
  if (isClaudeLoginTarget(target)) return false;
  if (url.includes("find_in_page") || url.includes("find-in-page")) return false;
  return isClaudeChatURL(url);
}

function isClaudeChatURL(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    return parsed.protocol === "https:" && (parsed.hostname === "claude.ai" || parsed.hostname === "claude.com");
  } catch {
    return false;
  }
}

function isClaudeLoginTarget(target) {
  const url = String(target.url || "").toLowerCase();
  const title = String(target.title || "").toLowerCase();
  return url.includes("/login") || url.includes("/logout") || url.includes("/oauth") || title.includes("sign in");
}

function cdpEvaluate(wsUrl, expression, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === "undefined") {
      reject(new Error("global WebSocket is unavailable in this Node runtime"));
      return;
    }
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("CDP Runtime.evaluate timed out"));
    }, timeoutMs);
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression,
          awaitPromise: true,
          returnByValue: true
        }
      }));
    });
    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      if (msg.error) {
        reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        return;
      }
      if (msg.result && msg.result.exceptionDetails) {
        reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
        return;
      }
      resolve(msg.result && msg.result.result ? msg.result.result.value : undefined);
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP WebSocket error"));
    });
  });
}

function domSubmitExpression(prompt, submit) {
  return `(async () => {
    const text = ${JSON.stringify(prompt)};
    const shouldSubmit = ${submit ? "true" : "false"};
    const url = String(location.href || "").toLowerCase();
    const title = String(document.title || "").toLowerCase();
    if (/\\/(login|logout|oauth)(?:[/?#]|$)/.test(url) || title.includes("sign in")) {
      throw new Error("Claude Desktop is not on an authenticated chat page");
    }
    const visible = (el) => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const isEditable = (el) => {
      if (!el || el === document.body || el === document.documentElement) return false;
      if (el.matches && el.matches("input[type='text']")) return false;
      return el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.tagName === "TEXTAREA" || el.getAttribute("role") === "textbox";
    };
    const getText = (el) => {
      if (!el) return "";
      if (el.isContentEditable || el.getAttribute("contenteditable") === "true") return el.innerText || el.textContent || "";
      return el.value || "";
    };
    const isDisabled = (button) => !button || Boolean(button.disabled) || button.getAttribute("aria-disabled") === "true" || button.hasAttribute("disabled");
    const findSubmitButton = () => Array.from(document.querySelectorAll("button")).filter(visible).find((button) => {
      if (isDisabled(button)) return false;
      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.getAttribute("data-testid"),
        button.innerText,
        button.type
      ].filter(Boolean).join(" ");
      return /(^|\s)(send|submit)(\s|$)|发送|提交/i.test(label) || button.type === "submit";
    });
    const waitForSubmitButton = async () => {
      const deadline = Date.now() + 5000;
      let button = findSubmitButton();
      while (!button && Date.now() < deadline) {
        await sleep(100);
        button = findSubmitButton();
      }
      return button;
    };
    const dispatchEnter = (el) => {
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
      }
    };
    const activateButton = (button) => {
      const rect = button.getBoundingClientRect();
      const eventInit = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, button: 0, buttons: 1 };
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        const event = type.startsWith("pointer") && typeof PointerEvent !== "undefined"
          ? new PointerEvent(type, { ...eventInit, pointerId: 1, pointerType: "mouse", isPrimary: true })
          : new MouseEvent(type, eventInit);
        button.dispatchEvent(event);
      }
      button.click();
    };
    const inputContainsPrompt = (el) => {
      const marker = text.trim().slice(0, 80);
      const current = getText(el).trim();
      return marker !== "" && current.includes(marker);
    };
    const waitForSubmitted = async (el) => {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        if (!inputContainsPrompt(el)) return true;
        await sleep(150);
      }
      return false;
    };
    const inputs = Array.from(document.querySelectorAll([
      "textarea",
      "[contenteditable=true]",
      "div[role=textbox]",
      "[data-testid*=chat-input]",
      "[aria-label*=message i]",
      "[aria-label*=prompt i]"
    ].join(","))).filter(visible);
    const input = inputs.find(isEditable) || (visible(document.activeElement) && isEditable(document.activeElement) ? document.activeElement : null);
    if (!input) throw new Error("No visible Claude Desktop input found");
    input.focus();
    if (input.isContentEditable || input.getAttribute("contenteditable") === "true") {
      const range = document.createRange();
      range.selectNodeContents(input);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("insertText", false, text);
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } else {
      input.value = text;
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (!shouldSubmit) return { ok: true, submitted: false };
    let submitMethod = "button";
    const submitButton = await waitForSubmitButton();
    if (submitButton) {
      activateButton(submitButton);
    } else {
      submitMethod = "enter";
      dispatchEnter(input);
    }
    let submitted = await waitForSubmitted(input);
    if (!submitted && submitButton) {
      submitMethod = "button+enter";
      dispatchEnter(input);
      submitted = await waitForSubmitted(input);
    }
    if (!submitted) return { ok: false, submitted: false, error: "Claude Desktop submit did not clear the prompt input" };
    return { ok: true, submitted: true, submitMethod };
  })()`;
}

async function deliverViaCDP(endpoint, selector, prompt, submit) {
  const cdp = await probeCDP(endpoint);
  if (!cdp.available) throw new Error(`CDP unavailable: ${cdp.error || "no targets"}`);
  const target = selectTarget(cdp, selector);
  const result = await cdpEvaluate(target.webSocketDebuggerUrl, domSubmitExpression(prompt, submit));
  return { target, result };
}

function deliverViaAppleScript(prompt, submit) {
  const script = [
    'tell application "Claude" to activate',
    'delay 0.5',
    'set the clipboard to ' + JSON.stringify(prompt),
    'tell application "System Events"',
    '  keystroke "v" using command down',
    submit ? '  key code 36' : '',
    'end tell'
  ].filter(Boolean).join("\n");
  const res = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error((res.stderr || res.stdout || "osascript failed").trim());
  }
  return { submitted: Boolean(submit) };
}

async function commandForceCDP(args) {
  const port = String(args.port || "19334");
  const endpoint = `http://127.0.0.1:${port}`;
  if (args["try-launch"]) {
    spawnSync("osascript", ["-e", 'tell application "Claude" to quit'], { encoding: "utf8" });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const launchArgs = [
      "-na",
      DEFAULT_APP_PATH,
      "--args",
      `--remote-debugging-port=${port}`,
      "--remote-debugging-address=127.0.0.1",
      "--remote-allow-origins=*"
    ];
    if (args["mock-keychain"]) {
      launchArgs.push("--use-mock-keychain", "--password-store=basic");
    }
    const child = spawn("open", launchArgs, { detached: true, stdio: "ignore" });
    child.unref();
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  const info = await status({ ...args, endpoint });
  info.force_cdp = {
    attempted_launch: Boolean(args["try-launch"]),
    conclusion: info.cdp.available
      ? "CDP is available."
      : "CDP is not available. This Claude Desktop build has a CDP auth guard; unauthenticated --remote-debugging-port is expected to fail."
  };
  return info;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || args.help) usage(0);
  const json = Boolean(args.json);

  try {
    if (cmd === "status") {
      output(await status(args), json);
      return;
    }
    if (cmd === "force-cdp") {
      output(await commandForceCDP(args), json);
      return;
    }
    if (cmd === "enqueue" || cmd === "deliver") {
      const envelope = normalizeEnvelope(args);
      const prompt = buildPrompt(envelope);
      const inbox = String(args.inbox || DEFAULT_INBOX);
      if (cmd === "enqueue") {
        output({ status: "queued", inbox_path: writeInbox(inbox, envelope, prompt), envelope_id: envelope.id }, json);
        return;
      }

      const endpoint = String(args.endpoint || DEFAULT_ENDPOINT);
      const fallback = String(args.fallback || "inbox");
      const submit = Boolean(args.submit);
      try {
        const delivered = await deliverViaCDP(endpoint, args.selector || "", prompt, submit);
        output({ status: "delivered", backend: "cdp", envelope_id: envelope.id, delivered }, json);
        return;
      } catch (error) {
        if (fallback === "none") throw error;
        if (fallback === "ui") {
          const delivered = deliverViaAppleScript(prompt, submit);
          output({ status: "delivered", backend: "ui", envelope_id: envelope.id, cdp_error: error.message, delivered }, json);
          return;
        }
        output({
          status: "queued",
          backend: "inbox",
          envelope_id: envelope.id,
          inbox_path: writeInbox(inbox, envelope, prompt),
          cdp_error: error.message
        }, json);
        return;
      }
    }
    usage(1);
  } catch (error) {
    output({ status: "error", error: error.message }, json);
    process.exit(1);
  }
}

main();
