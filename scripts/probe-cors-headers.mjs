const origin = "https://www.youtube.com";
const targets = [
  ["translate", "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=vi&dt=t&q=hello"],
  ["tts", "https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=vi&q=" + encodeURIComponent("xin chào")],
];
for (const [name, url] of targets) {
  const response = await fetch(url, {
    headers: {
      origin,
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
    },
  });
  const acao = response.headers.get("access-control-allow-origin");
  const acac = response.headers.get("access-control-allow-credentials");
  const length = Number(response.headers.get("content-length") ?? 0);
  console.log(`${name} status=${response.status} acao=${acao ?? "(none)"} acac=${acac ?? "(none)"} len=${length}`);
  await response.arrayBuffer();
}
