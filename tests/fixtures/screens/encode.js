// tests/fixtures/screens/encode.js
// Small PNGs for the screenshot tests, written with a chosen filter, compression level, colour
// type and extra chunks, so the same pixels can be written more than one way.
import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// One chunk: length, type, data and CRC.
export function chunk(type, data = Buffer.alloc(0)) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// The bytes of one row written with filter `f`, given the row above (unfiltered).
function filterRow(f, row, above, bpp) {
  const out = Buffer.alloc(row.length);
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = above ? above[i] : 0;
    const c = above && i >= bpp ? above[i - bpp] : 0;
    const predictor = [0, a, b, (a + b) >> 1, paeth(a, b, c)][f] ?? 0;
    out[i] = (row[i] - predictor) & 0xff;
  }
  return Buffer.concat([Buffer.from([f]), out]);
}

// A solid picture as RGBA bytes, with an optional change at one pixel.
export function solid(width, height, [r, g, b, a = 255], { at, colour } = {}) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) pixels.set([r, g, b, a], i * 4);
  if (at) pixels.set(colour, (at.y * width + at.x) * 4);
  return pixels;
}

// A PNG of `pixels` (RGBA). `filter` is a number for every row or a function of the row's index;
// `colourType` 2 drops the alpha; `extra` chunks go before the image data, which is split into
// `parts` IDAT chunks. `header` overrides IHDR fields, for PNGs the reader must refuse.
export function encodePng({ width, height, pixels, colourType = 6, filter = 0, level = 6, extra = [], parts = 1, header = {} }) {
  const bpp = colourType === 2 ? 3 : 4;
  const rows = [];
  let above = null;
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * bpp);
    for (let x = 0; x < width; x++) {
      for (let k = 0; k < bpp; k++) row[x * bpp + k] = pixels[(y * width + x) * 4 + k];
    }
    const f = typeof filter === 'function' ? filter(y) : filter;
    rows.push(filterRow(f, row, above, bpp));
    above = row;
  }
  const data = zlib.deflateSync(Buffer.concat(rows), { level });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(header.width ?? width, 0);
  ihdr.writeUInt32BE(header.height ?? height, 4);
  ihdr[8] = header.bitDepth ?? 8;
  ihdr[9] = header.colourType ?? colourType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = header.interlace ?? 0;
  const size = Math.ceil(data.length / parts);
  const idats = [];
  for (let i = 0; i < parts; i++) idats.push(chunk('IDAT', data.subarray(i * size, (i + 1) * size)));
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), ...extra.map(([type, body]) => chunk(type, Buffer.from(body))), ...idats, chunk('IEND')]);
}
