const fs = require("fs");
const zlib = require("zlib");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const cd = Buffer.concat([t, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(cd));
  return Buffer.concat([len, cd, crc]);
}
function png(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, y * w * 4 + w * 4);
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}
const lerp = (a, b, t) => a + (b - a) * t;

function make(size) {
  const w = size, h = size, px = Buffer.alloc(w * h * 4);
  const cx = (w - 1) / 2, cy = (h - 1) / 2, R = size * 0.46, edge = size * 0.04 + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - cx, y - cy);
    let r = 0, g = 0, b = 0, a = 0;
    if (d <= R + edge) {
      const gr = Math.min(1, Math.max(0, (x / w + y / h) / 2));
      r = Math.round(lerp(59, 99, gr)); g = Math.round(lerp(130, 102, gr)); b = Math.round(lerp(246, 241, gr));
      a = Math.round(255 * Math.min(1, (R + edge - d) / edge));
    }
    const i = (y * w + x) * 4; px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
  }
  const setpx = (x, y) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = (y * w + x) * 4; px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255;
  };
  const line = (x0, y0, x1, y1, thick) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 3);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, x = lerp(x0, x1, t), y = lerp(y0, y1, t);
      for (let ox = -thick; ox <= thick; ox++) for (let oy = -thick; oy <= thick; oy++)
        if (ox * ox + oy * oy <= thick * thick) setpx(x + ox, y + oy);
    }
  };
  const thick = Math.max(0.6, size * 0.035);
  line(cx, cy, cx, cy - R * 0.52, thick);          // hour hand (12)
  line(cx, cy, cx + R * 0.4, cy + R * 0.04, thick * 0.85); // minute hand (3)
  return png(w, h, px);
}
for (const s of [16, 32, 48, 128]) {
  fs.writeFileSync(`icons/icon${s}.png`, make(s));
  console.log("wrote icons/icon" + s + ".png");
}
