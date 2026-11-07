import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { writeFileSync } from "node:fs";

const VOICE = "vi-VN-HoaiMyNeural";
const TEXT = "Xin chào, đây là bài kiểm tra lồng tiếng tiếng Việt cho video YouTube.";

function toBuffer(chunk) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (chunk && chunk.audio) return toBuffer(chunk.audio);
  return Buffer.alloc(0);
}

const tts = new MsEdgeTTS();
await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

const t0 = performance.now();
const { audioStream: stream } = tts.toStream(TEXT);
const chunks = [];
let firstByteAt = null;

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("timeout 30s")), 30000);
  stream.on("data", (chunk) => {
    if (firstByteAt === null) firstByteAt = performance.now() - t0;
    chunks.push(toBuffer(chunk));
  });
  stream.on("close", () => {
    clearTimeout(timer);
    resolve();
  });
  stream.on("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

const audio = Buffer.concat(chunks);
writeFileSync("out.mp3", audio);
tts.close();

console.log("voice=" + VOICE);
console.log("bytes=" + audio.length);
console.log("first_byte_ms=" + Math.round(firstByteAt ?? -1));
console.log("total_ms=" + Math.round(performance.now() - t0));
