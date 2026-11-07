const probes = [
  "I use [[0]] and [[1]] inside [[2]] every day.",
  "We deploy [[0]] to [[1]] then cache it in [[2]].",
];
for (const text of probes) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "auto");
  url.searchParams.set("tl", "vi");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", text);
  const res = await fetch(url);
  const raw = await res.text();
  const parsed = JSON.parse(raw);
  const vi = (parsed?.[0] ?? []).map((part) => part?.[0] ?? "").join("");
  console.log("IN :", text);
  console.log("VI :", vi);
  console.log("");
}
