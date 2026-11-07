import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import WebSocket from "ws";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const HOSTS = [
  "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1",
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1",
];
const WIN_EPOCH = 11644473600n;
const TICKS_PER_SECOND = 10000000n;
const FIVE_MINUTES = 3000000000n;

function secMsGec(skewSeconds = 0) {
  let ticks = (BigInt(Math.floor(Date.now() / 1000) + skewSeconds) + WIN_EPOCH) * TICKS_PER_SECOND;
  ticks -= ticks % FIVE_MINUTES;
  return createHash("sha256").update(`${ticks}${TRUSTED_CLIENT_TOKEN}`, "ascii").digest("hex").toUpperCase();
}

const CONFIG_BODY = JSON.stringify({
  context: {
    synthesis: {
      audio: {
        metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
        outputFormat: "audio-24khz-48kbitrate-mono-mp3",
      },
    },
  },
});

const configFrame = () =>
  `X-Timestamp:${Date.now()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n${CONFIG_BODY}`;

function ssmlFrame(text, voice) {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escaped}</prosody></voice></speak>`;
  return (
    `X-RequestId:${randomUUID().replace(/-/g, "")}\r\nContent-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${Date.now()}\r\nPath:ssml\r\n\r\n${ssml}`
  );
}

const WS_HEADERS = {
  Pragma: "no-cache",
  "Cache-Control": "no-cache",
  Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  "Accept-Encoding": "gzip, deflate, br",
  "Accept-Language": "en-US,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
};

function synthesize({ host, text, voice, version, timeoutMs = 20000 }) {
  const url =
    `${host}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${secMsGec()}` +
    `&Sec-MS-GEC-Version=${version}` +
    `&ConnectionId=${randomUUID().replace(/-/g, "")}`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers: WS_HEADERS });
    const chunks = [];
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      fn(value);
    };
    const timer = setTimeout(() => finish(reject, new Error("timeout")), timeoutMs);

    ws.on("open", () => {
      ws.send(configFrame());
      ws.send(ssmlFrame(text, voice));
    });

    ws.on("message", (data, isBinary) => {
      const buf = isBinary ? data : Buffer.from(String(data), "utf8");
      if (!isBinary) {
        const frame = buf.toString("utf8");
        if (frame.includes("Path:turn.end")) finish(resolve, { bytes: Buffer.concat(chunks), frames: chunks.length });
        else if (frame.includes("Path:error")) finish(reject, new Error(frame.replace(/\s+/g, " ").slice(0, 400)));
        return;
      }
      const headerLen = buf.readUInt16BE(0);
      const header = buf.subarray(2, 2 + headerLen).toString("utf8");
      if (header.includes("Path:audio")) chunks.push(buf.subarray(2 + headerLen));
    });

    ws.on("error", (error) => finish(reject, new Error("ws error: " + error.message)));
    ws.on("close", (code, reason) => {
      if (!settled) finish(reject, new Error(`closed code=${code} reason=${reason?.toString() || "(empty)"}`));
    });
  });
}

const VOICE = "vi-VN-HoaiMyNeural";
const TEXT = "Xin chào, đây là bài kiểm tra lồng tiếng tiếng Việt cho video YouTube.";
const VERSIONS = ["1-143.0.3650.75", "1-130.0.2849.68"];

for (const host of HOSTS) {
  for (const version of VERSIONS) {
    const t0 = performance.now();
    try {
      const { bytes, frames } = await synthesize({ host, text: TEXT, voice: VOICE, version });
      writeFileSync("out.mp3", bytes);
      console.log(`OK host=${host.split("/")[2]} version=${version} bytes=${bytes.length} frames=${frames} ms=${Math.round(performance.now() - t0)}`);
      console.log("head=" + Array.from(bytes.slice(0, 4)).map((b) => b.toString(16).padStart(2, "0")).join(" "));
      process.exit(0);
    } catch (error) {
      console.log(`FAIL host=${host.split("/")[2]} version=${version} ms=${Math.round(performance.now() - t0)} :: ${error.message}`);
    }
  }
}
process.exit(1);
