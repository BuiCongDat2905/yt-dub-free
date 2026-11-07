import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const EXT = "D:\\Ai20K\\yt-dub-free\\.output\\chrome-mv3";
const PORT = 9888;
const videoId = process.argv[2] ?? "Rm0t1KwFmBw";

const profile = mkdtempSync(join(tmpdir(), "ytdubfree-e2e-dub-"));
const browser = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    `--remote-debugging-port=${PORT}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label, timeoutMs = 90000) {
  const started = Date.now();
  for (;;) {
    const value = await fn().catch(() => null);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("timeout " + label);
    await sleep(500);
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
const consoleLines = [];
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
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

const created = await send("Target.createTarget", { url: `https://www.youtube.com/watch?v=${videoId}` });
const targetId = created.result?.targetId;
const attached = await send("Target.attachToTarget", { targetId, flatten: true });
const sessionId = attached.result?.sessionId;
await send("Runtime.enable", {}, sessionId);

const evaluate = async (expression) => {
  const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  return reply.result?.result?.value;
};

const readDataset = async () => {
  const raw = await evaluate("document.documentElement.dataset.ytdubfree || ''");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

try {
  await waitFor(async () => (await evaluate("!!document.getElementById('ytdubfree-badge')")) && true, "badge");
  console.log("badge=ok");

  await waitFor(async () => {
    const status = await readDataset();
    return status && status.tracks !== undefined ? status : null;
  }, "tracks");
  console.log("tracks=ok");

  await sleep(1500);
  await evaluate("document.querySelector('video')?.play()");
  console.log("video.play()");

  const speed = Number(process.argv[3] ?? "1");
  if (Number.isFinite(speed) && speed !== 1) {
    await evaluate(`document.querySelector('video').playbackRate = ${speed}`);
    console.log(`playbackRate=${speed}`);
  }

  const rect = await waitFor(
    () =>
      evaluate(
        "(() => { const host = document.getElementById('ytdubfree-badge'); if (!host) return null; const r = host.getBoundingClientRect(); return r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null; })()",
      ),
    "badge visible",
    20000,
  );
  const click = (type) =>
    send("Input.dispatchMouseEvent", { type, x: rect.x, y: rect.y, button: "left", clickCount: 1 }, sessionId);
  await click("mousePressed");
  await click("mouseReleased");
  console.log("clicked badge (trusted)");

  const samples = [];
  let firstStatus = null;
  for (let step = 0; step < 45; step += 1) {
    await sleep(1000);
    const status = await readDataset();
    if (!status) continue;
    if (!firstStatus) {
      firstStatus = status;
      console.log(`first source=${status.source || "(none)"} diagnostics=${status.diagnostics?.length ?? 0}`);
    }
    if (status.error) {
      samples.push({ error: status.error.slice(0, 120) });
      break;
    }
    const live = status.live ?? {};
    const debug = live.debug ?? {};
    const tracker = live.tracker ?? {};
    samples.push({
      lines: live.lines ?? 0,
      audio: status.stats?.audio ?? 0,
      cuts: live.cuts ?? 0,
      skips: live.skips ?? 0,
      speaking: debug.speaking === true,
      audioTime: debug.audioTime ?? -1,
      rate: debug.rate ?? -1,
      mut: tracker.mutations ?? -1,
      raw: tracker.rawLength ?? -1,
      emitted: tracker.emitted ?? -1,
      cc: tracker.ccEnabled === true,
    });
    if ((live.lines ?? 0) >= 5 && (status.stats?.audio ?? 0) >= 3) break;
  }

  const label = speed === 1 ? "1x" : `${speed}x`;
  console.log(`--- trace ${label} ---`);
  for (const [index, sample] of samples.entries()) {
    console.log(
      `t=${index + 1}s lines=${sample.lines} audio=${sample.audio} cuts=${sample.cuts} skips=${sample.skips} ` +
        `speaking=${sample.speaking ? "Y" : "-"} audioTime=${sample.audioTime} rate=${sample.rate} ` +
        `mut=${sample.mut} raw=${sample.raw} emitted=${sample.emitted} cc=${sample.cc ? "Y" : "-"}` +
        (sample.error ? ` error=${sample.error}` : ""),
    );
  }

  const speakingSamples = samples.filter((sample) => sample.speaking === true).length;
  const cuts = Math.max(...samples.map((sample) => sample.cuts ?? 0));
  const maxLines = Math.max(...samples.map((sample) => sample.lines ?? 0));
  const maxAudio = Math.max(...samples.map((sample) => sample.audio ?? 0));
  console.log(
    `SUMMARY ${label} lines=${maxLines} audio=${maxAudio} cuts=${cuts} speaking_samples=${speakingSamples}/${samples.length}`,
  );
  console.log(cuts === 0 && speakingSamples >= 3 && maxAudio >= 2 ? `PASS ${label}` : `FAIL ${label}`);
} catch (error) {
  console.log(`FAIL ${error.message}`);
  const status = await readDataset().catch(() => null);
  if (status) console.log("partial=" + JSON.stringify(status, null, 2));
  for (const line of consoleLines.slice(-10)) console.log(line.slice(0, 300));
  process.exitCode = 1;
}

await send("Browser.close").catch(() => {});
socket.close();
browser.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
