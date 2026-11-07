import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9444;
const videoId = process.argv[2] ?? "dQw4w9WgXcQ";

const profile = mkdtempSync(join(tmpdir(), "ytdubfree-dom-"));
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

const probe = `(() => {
  const q = (s) => document.querySelectorAll(s).length;
  const text = (el) => (el?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 80);
  document.querySelector('#expand')?.click();
  const buttons = Array.from(document.querySelectorAll('button, tp-yt-paper-button, a'))
    .filter((el) => /transcript|bảng điểm|bảng ghi/i.test(el.innerText || ""))
    .slice(0, 6)
    .map((el) => el.tagName + ':' + text(el));
  return JSON.stringify({
    readyState: document.readyState,
    transcriptSection: q('ytd-video-description-transcript-section-renderer'),
    transcriptRenderer: q('ytd-transcript-renderer'),
    transcriptSegments: q('ytd-transcript-segment-renderer'),
    expandButtons: q('#expand'),
    inlineExpander: q('ytd-text-inline-expander'),
    descriptionBlock: q('#description'),
    matchingButtons: buttons,
  });
})()`;

console.log(await evaluate(probe));
await sleep(1500);
console.log(
  await evaluate(`JSON.stringify({
    transcriptRenderer: document.querySelectorAll('ytd-transcript-renderer').length,
    transcriptSegments: document.querySelectorAll('ytd-transcript-segment-renderer').length,
    buttonsAfter: Array.from(document.querySelectorAll('button, tp-yt-paper-button, a'))
      .filter((el) => /transcript|bảng/i.test(el.innerText || '')).slice(0, 6)
      .map((el) => el.tagName + ':' + (el.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 60)),
  })`),
);

await send("Browser.close").catch(() => {});
socket.close();
browser.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
