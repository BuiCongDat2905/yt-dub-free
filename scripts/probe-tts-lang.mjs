for (const lang of ["en", "vi"]) {
  const url = new URL("https://translate.google.com/translate_tts");
  url.searchParams.set("ie", "UTF-8");
  url.searchParams.set("client", "tw-ob");
  url.searchParams.set("tl", lang);
  url.searchParams.set("q", lang === "en" ? "React and API" : "React và API");
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36" } });
    const buf = await res.arrayBuffer();
    console.log(`tl=${lang} status=${res.status} bytes=${buf.byteLength}`);
  } catch (error) {
    console.log(`tl=${lang} fetch_error=${error.message}`);
  }
}
