const origin = "https://www.youtube.com";
const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";
const variants = [
  ["googleapis-tts", "https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=" + encodeURIComponent("xin chào các bạn")],
  ["googleapis-tts-client-gtx", "https://translate.googleapis.com/translate_tts?ie=UTF-8&client=gtx&tl=vi&q=" + encodeURIComponent("xin chào các bạn")],
  ["google-tts-cors", "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=" + encodeURIComponent("xin chào các bạn")],
];
for (const [name, url] of variants) {
  try {
    const response = await fetch(url, { headers: { origin, "user-agent": ua } });
    const buffer = await response.arrayBuffer();
    console.log(`${name} status=${response.status} bytes=${buffer.byteLength} acao=${response.headers.get("access-control-allow-origin") ?? "(none)"}`);
  } catch (error) {
    console.log(`${name} FAIL ${String(error).slice(0, 120)}`);
  }
}
