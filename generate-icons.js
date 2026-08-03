// Generates public/icon-192.png and public/icon-512.png without external deps
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

// CRC-32 used by PNG chunks
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([l, t, data, cr]);
}

function drawIcon(nx, ny) {
  // House shape in normalised coords [-1, 1]
  const x = nx, y = ny;
  // Body
  if (x > -0.38 && x < 0.38 && y > -0.08 && y < 0.58) {
    // Door
    if (x > -0.13 && x < 0.13 && y > 0.22 && y < 0.58) return false;
    // Window left
    if (x > -0.33 && x < -0.13 && y > -0.02 && y < 0.18) return false;
    // Window right
    if (x > 0.13 && x < 0.33 && y > -0.02 && y < 0.18) return false;
    return true;
  }
  // Roof triangle: apex at y=-0.68, base at y=-0.08, half-width 0.48
  if (y > -0.68 && y < -0.08) {
    const t = (y + 0.68) / 0.60; // 0 = apex, 1 = base
    if (Math.abs(x) < 0.48 * t) return true;
  }
  // Chimney
  if (x > 0.18 && x < 0.30 && y > -0.78 && y < -0.52) return true;
  return false;
}

function makePNG(size) {
  const BG = [0x1e, 0x0f, 0x02]; // dark brown
  const FG = [0xc0, 0x8a, 0x2f]; // amber

  // Add a subtle rounded-rect background tint (slightly lighter brown)
  const raw = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 3)] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const nx = (x / size - 0.5) * 2;
      const ny = (y / size - 0.5) * 2;
      const fg = drawIcon(nx, ny);
      const off = y * (1 + size * 3) + 1 + x * 3;
      raw[off]     = fg ? FG[0] : BG[0];
      raw[off + 1] = fg ? FG[1] : BG[1];
      raw[off + 2] = fg ? FG[2] : BG[2];
    }
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = path.join(__dirname, 'public');
fs.writeFileSync(path.join(out, 'icon-192.png'), makePNG(192));
fs.writeFileSync(path.join(out, 'icon-512.png'), makePNG(512));
console.log('Icons generated: icon-192.png, icon-512.png');
