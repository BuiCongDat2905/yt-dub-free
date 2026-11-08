async function probe(name, url) {
  try {
    const res = await fetch(url);
    const body = await res.text();
    console.log(`${name} status=${res.status} bytes=${body.length} acao=${res.headers.get("access-control-allow-origin") ?? "(none)"}`);
    console.log(`${name} body=${body.slice(0, 200).replace(/\s+/g, " ")}`);
  } catch (error) {
    console.log(`${name} fetch_error=${error.message}`);
  }
}
const q = encodeURIComponent("Hello everyone, today we test dubbing.");
await probe("clients5-dict", `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=vi&q=${q}`);
await probe("clients5-t", `https://clients5.google.com/translate_a/t?client=te&sl=auto&tl=vi&q=${q}`);
await probe("googleapis-gtx", `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=${q}`);
const voicesRes = await fetch("https://huggingface.co/rhasspy/piper-voices/raw/main/voices.json");
const voices = await voicesRes.json();
const vi = Object.entries(voices).filter(([key]) => key.toLowerCase().includes("vi_vn"));
for (const [key, value] of vi) {
  console.log(`voice=${key} quality=${value.quality ?? "?"} files=${Object.keys(value.files ?? {}).join(",")}`);
}
console.log(`voice_count=${vi.length}`);
