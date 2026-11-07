import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9777;
const videoId = process.argv[2] ?? "dQw4w9WgXcQ";

const profile = mkdtempSync(join(tmpdir(), "ytdubfree-cors-"));
const browser = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeoutMs = 45000) {
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
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
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

const created = await send("Target.createTarget", { url: `https://www.youtube.com/watch?v=${videoId}` });
const targetId = created.result?.targetId;
const attached = await send("Target.attachToTarget", { targetId, flatten: true });
const sessionId = attached.result?.sessionId;
await send("Runtime.enable", {}, sessionId);

const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  return reply.result?.result?.value;
};

await waitFor(async () => (await evaluate("document.readyState === 'complete'")) && true, "ready");

const probe = `(async () => {
  const results = {};
  const test = async (name, url, type) => {
    try {
      const response = await fetch(url, { credentials: 'include' });
      if (type === 'json') {
        const data = await response.json();
        const text = Array.isArray(data?.[0]) ? data[0].map((s) => s[0]).join('') : '';
        results[name] = { ok: response.ok, status: response.status, text: String(text).slice(0, 40) };
      } else {
        const buffer = await response.arrayBuffer();
        results[name] = { ok: response.ok, status: response.status, bytes: buffer.byteLength };
      }
    } catch (error) {
      results[name] = { error: String(error) };
    }
  };
  await test('translate', 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=hello%20world', 'json');
  await test('tts', 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=' + encodeURIComponent('xin chào'), 'buffer');
  return JSON.stringify(results);
})()`;

const probeReply = await send(
  "Runtime.evaluate",
  { expression: probe, returnByValue: true, awaitPromise: true },
  sessionId,
);
const probeValue = probeReply.result?.result?.value;
if (probeValue === undefined) {
  console.log(JSON.stringify(probeReply).slice(0, 900));
}
console.log(probeValue ?? "(no value)");

await send("Browser.close").catch(() => {});
socket.close();
browser.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
