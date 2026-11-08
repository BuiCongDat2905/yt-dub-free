const base = "https://huggingface.co/diffusionstudio/piper-voices/resolve/main";
const candidates = [
  "vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx",
  "vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json",
  "vi/vi_VN/25hours_single/low/vi_VN-25hours_single-low.onnx",
];
for (const path of candidates) {
  const url = `${base}/${path}`;
  try {
    const res = await fetch(url, { method: "HEAD", redirect: "follow" });
    console.log(`${path} status=${res.status} len=${res.headers.get("content-length")} type=${res.headers.get("content-type")} final=${res.url.slice(0, 90)}`);
  } catch (error) {
    console.log(`${path} error=${error.message}`);
  }
}
