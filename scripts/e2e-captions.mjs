import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EXT = "D:\\Ai20K\\yt-dub-free\\.output\\chrome-mv3";
const PORT = 9333;
const ids = process.argv.slice(2);
if (ids.length === 0) {
  console.error("usage: node scripts/e2e-captions.mjs <videoId...>");
  process.exit(2);
}

const profile = mkdtempSync(join(tmpdir(), "ytdubfree-e2e-"));
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

async function waitFor(fn, { timeoutMs = 45000, intervalMs = 300, label = "condition" } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout ${label}`);
    await sleep(intervalMs);
  }
}

const version = await waitFor(
  async () => {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    return response.ok ? response.json() : null;
  },
  { label: "devtools endpoint" },
);

const socket = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let sequence = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});

function send(method, params = {}, sessionId) {
  const id = (sequence += 1);
  socket.send(JSON.stringify({ id, method, params, sessionId }));
  return new Promise((resolve) => pending.set(id, resolve));
}

let failures = 0;

for (const videoId of ids) {
  const created = await send("Target.createTarget", { url: `https://www.youtube.com/watch?v=${videoId}` });
  const targetId = created.result?.targetId;
  const attached = await send("Target.attachToTarget", { targetId, flatten: true });
  const sessionId = attached.result?.sessionId;
  await send("Runtime.enable", {}, sessionId);

  const evaluate = async (expression) => {
    const reply = await send(
      "Runtime.evaluate",
      { expression, returnByValue: true, awaitPromise: true },
      sessionId,
    );
    return reply.result?.result?.value;
  };

  const readStatus = async () => {
    const raw = await evaluate("document.documentElement.dataset.ytdubfree || ''");
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  try {
    const initial = await waitFor(
      async () => {
        const status = await readStatus();
        return status && (status.tracks !== undefined || status.error) ? status : null;
      },
      { label: `tracks ${videoId}` },
    );

    console.log(`id=${videoId} tracks=${initial.tracks ?? 0} lang=${initial.lang ?? "-"} asr=${initial.asr ?? "-"} error=${initial.error ?? "-"}`);
    if (!initial.tracks) console.log("   không có caption track — báo lỗi rõ, không crash");
  } catch (error) {
    failures += 1;
    console.log(`id=${videoId} FAIL :: ${error.message}`);
  } finally {
    await send("Target.closeTarget", { targetId });
  }
}

await send("Browser.close").catch(() => {});
socket.close();
browser.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });

console.log(failures === 0 ? "ALL OK" : `failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
