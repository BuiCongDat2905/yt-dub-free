import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EXT = "D:\\Ai20K\\yt-dub-free\\.output\\chrome-mv3";
const PORT = 9894;

const profile = mkdtempSync(join(tmpdir(), "ytdubfree-piper-"));
const browser = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, label, timeoutMs = 90000) {
  const started = Date.now();
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("timeout " + label);
    await sleep(300);
  }
}

const version = await waitFor(async () => {
  const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
  return response.ok ? response.json() : null;
}, "devtools");

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
const contexts = [];
const consoleLines = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.method === "Runtime.executionContextCreated") {
    contexts.push(message.params?.context);
  }
  if (message.method === "Runtime.consoleAPICalled") {
    const text = (message.params?.args ?? []).map((arg) => arg.value ?? arg.description ?? "").join(" ");
    if (text.trim() !== "") consoleLines.push(`[${message.params.type}] ${text}`);
  }
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}, sessionId) => {
  const id = (sequence += 1);
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve) => pending.set(id, resolve));
};

try {
  const created = await send("Target.createTarget", { url: "https://www.youtube.com/watch?v=Frmh29T4xTg" });
  const targetId = created.result?.targetId;
  const attached = await send("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = attached.result?.sessionId;
  await send("Runtime.enable", {}, sessionId);

  const evaluate = async (expression, contextId) => {
    const reply = await send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) },
      sessionId,
    );
    return reply.result?.result?.value;
  };

  await waitFor(async () => (await evaluate("!!document.getElementById('ytdubfree-badge')")) && true, "badge");

  const isolatedContext = await waitFor(async () => {
    for (const context of contexts) {
      if (!context?.id || context.auxData?.isDefault) continue;
      const hasRuntime = await evaluate("typeof chrome !== 'undefined' && !!chrome.runtime", context.id);
      if (hasRuntime) return context;
    }
    return null;
  }, "content script context");
  console.log("content_context=" + isolatedContext.id);

  console.log("bắt đầu synth Piper (lần đầu tải model ~63 MB)…");
  const started = Date.now();
  await evaluate(
    `(() => {
      window.__piperResult = { status: "pending" };
      chrome.runtime
        .sendMessage({
          type: "ytdubfree:piper-synth",
          text: "Xin chào, đây là giọng nữ tiếng Việt.",
          voiceId: "vi_VN-vais1000-medium",
        })
        .then((response) => {
          window.__piperResult = { status: "done", ok: !!response?.ok, bytes: response?.bytes ?? 0, error: response?.error ?? null };
        })
        .catch((error) => {
          window.__piperResult = { status: "error", ok: false, bytes: 0, error: String(error) };
        });
      return true;
    })()`,
    isolatedContext.id,
  );

  let summary = null;
  try {
    summary = await waitFor(
      async () => {
        const value = await evaluate("window.__piperResult || null", isolatedContext.id);
        return value && value.status !== "pending" ? value : null;
      },
      "piper result",
      240000,
    );
  } catch {
    const logs = await evaluate(
      "new Promise((resolve) => chrome.storage.local.get('ytdubfree.logs', (v) => resolve(v['ytdubfree.logs'] || [])))",
      isolatedContext.id,
    );
    console.log("TIMEOUT — log gần nhất:");
    for (const entry of (logs ?? []).slice(-10)) {
      console.log(`  [${entry.level}] ${entry.scope}: ${entry.message} ${entry.detail ?? ""}`);
    }
    console.log("console tail:");
    for (const line of consoleLines.slice(-8)) console.log("  " + line.slice(0, 300));
    process.exitCode = 1;
  }
  if (summary) {
    console.log(
      `piper_ok=${summary.ok} bytes=${summary.bytes} ms=${Date.now() - started} status=${summary.status} error=${summary.error ?? "none"}`,
    );
    process.exitCode = summary.ok ? 0 : 1;
  }
} finally {
  try {
    socket.close();
  } catch {
    // bỏ qua
  }
  browser.kill();
}
