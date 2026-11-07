import { GoogleTtsProvider } from "../lib/tts/google.ts";
import { TtsQueue } from "../lib/tts/queue.ts";

const SENTENCES = [
  "Xin chào mọi người, chào mừng quay trở lại với kênh.",
  "Hôm nay chúng ta sẽ xem cách lồng tiếng hoạt động.",
  "Toàn bộ xử lý chạy trong trình duyệt của bạn.",
];

const store = new Map();
const cache = {
  async get(key) {
    return store.has(key) ? store.get(key) : null;
  },
  async set(key, value) {
    store.set(key, value);
  },
};

let network = 0;
const fetchImpl = async (url, init) => {
  network += 1;
  return fetch(url, init);
};

console.log("--- provider đơn lẻ ---");
const single = new GoogleTtsProvider({ fetchImpl });
const started = Date.now();
const audio = await single.synthesize(SENTENCES[0] ?? "");
const magic = Array.from(audio.slice(0, 4))
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join(" ");
console.log(`bytes=${audio.length} ms=${Date.now() - started} head=${magic}`);

console.log("--- hàng đợi + cache ---");
const queue = new TtsQueue({ provider: single, cache, concurrency: 3 });
const run1 = Date.now();
const first = await queue.synthesizeAll(SENTENCES);
const firstNetwork = network;
console.log(
  `run1 ms=${Date.now() - run1} network=${firstNetwork} audio_sizes=${first
    .map((result) => result.audio?.length ?? 0)
    .join(",")} peak=${queue.stats.peakInFlight}`,
);

const second = new TtsQueue({ provider: single, cache, concurrency: 3 });
const run2 = Date.now();
const again = await second.synthesizeAll(SENTENCES);
console.log(
  `run2 ms=${Date.now() - run2} network_added=${network - firstNetwork} ` +
    `cache_all=${again.every((result) => result.fromCache === true)}`,
);

const sizesEqual =
  first.length === again.length &&
  first.every((result, index) => (result.audio?.length ?? 0) === (again[index]?.audio?.length ?? 0));
console.log(`same_audio_size=${sizesEqual}`);
