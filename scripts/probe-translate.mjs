import { translateBatch } from "../lib/translate/google.ts";

const SENTENCES = [
  "Hello everyone, welcome back to the channel.",
  "Today we are going to look at how dubbing works.",
  "It is free and runs entirely in your browser.",
  "The pipeline reads captions, translates them, and speaks them.",
  "No paid API key is required.",
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

let networkCalls = 0;
const countingFetch = async (url, init) => {
  networkCalls += 1;
  return fetch(url, init);
};

const first = Date.now();
const translated = await translateBatch(SENTENCES, {
  targetLang: "vi",
  concurrency: 3,
  cache,
  fetchImpl: countingFetch,
});
console.log(`run1 ms=${Date.now() - first} network=${networkCalls}`);
translated.forEach((text, index) => console.log(`  ${index + 1}. ${text}`));

const before = networkCalls;
const second = Date.now();
const again = await translateBatch(SENTENCES, {
  targetLang: "vi",
  concurrency: 3,
  cache,
  fetchImpl: countingFetch,
});
console.log(`run2 ms=${Date.now() - second} network_added=${networkCalls - before}`);
console.log(`cache_hit=${networkCalls === before} same_result=${JSON.stringify(translated) === JSON.stringify(again)}`);
