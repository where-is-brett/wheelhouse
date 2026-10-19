// scripts/screens/png.js
// A picture's pixels as one hash, so two screenshots compare by what they show and not by how the
// PNG was written: metadata chunks, how the data was split and compressed, and the filters drop out.
// Only the PNGs a browser's screenshot gives are read (8 bits, RGB or RGBA, not interlaced); any
// other is refused rather than guessed at.
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Bytes per pixel for the colour types read: 2 is RGB, 6 is RGBA.
const BYTES = { 2: 3, 6: 4 };
// More pixels than any screenshot has: refused before inflating, so a bad file can't fill memory.
const MOST_PIXELS = 64 * 1024 * 1024;

function refuse(why) {
  throw new Error(`Unsupported PNG: ${why}`);
}

// The chunks after the signature, up to and including IEND, as { type, data }.
function chunks(png) {
  const found = [];
  let at = SIGNATURE.length;
  while (true) {
    if (at + 12 > png.length) refuse('the data ends early');
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    if (at + 12 + length > png.length) refuse('the data ends early');
    found.push({ type, data: png.subarray(at + 8, at + 8 + length) });
    at += 12 + length;
    if (type === 'IEND') return found;
  }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// The rows of `raw` with their filters undone, as RGBA.
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * 4);
  let above = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    if (filter > 4) refuse(`filter ${filter}`);
    const row = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    // None (0) leaves the row as it is; Sub, Up, Average and Paeth add back what they predicted.
    if (filter !== 0) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0;
        const b = above[i];
        const c = i >= bpp ? above[i - bpp] : 0;
        const predicted = filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c);
        row[i] = (row[i] + predicted) & 0xff;
      }
    }
    for (let x = 0; x < width; x++) {
      const to = (y * width + x) * 4;
      rgba[to] = row[x * bpp];
      rgba[to + 1] = row[x * bpp + 1];
      rgba[to + 2] = row[x * bpp + 2];
      rgba[to + 3] = bpp === 4 ? row[x * bpp + 3] : 255;
    }
    above = row;
  }
  return rgba;
}

// SHA-256 (hex) of the width and height (4 bytes each, big-endian) and the RGBA pixels. Throws on a
// PNG it does not read.
export function pixelHash(png) {
  if (!Buffer.isBuffer(png) || png.length < SIGNATURE.length || !png.subarray(0, SIGNATURE.length).equals(SIGNATURE)) refuse('not a PNG');
  const all = chunks(png);
  const ihdr = all[0];
  if (ihdr.type !== 'IHDR' || ihdr.data.length !== 13) refuse('no header');
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const [bitDepth, colourType, compression, filtering, interlace] = ihdr.data.subarray(8);
  if (width === 0 || height === 0 || width * height > MOST_PIXELS) refuse(`size ${width}x${height}`);
  if (bitDepth !== 8) refuse(`bit depth ${bitDepth}`);
  if (!BYTES[colourType]) refuse(`colour type ${colourType}`);
  if (compression !== 0 || filtering !== 0) refuse('unknown compression or filtering');
  if (interlace !== 0) refuse('interlaced');
  // A transparency key would change what RGB pixels show.
  if (all.some((c) => c.type === 'tRNS')) refuse('transparency key');
  const data = all.filter((c) => c.type === 'IDAT').map((c) => c.data);
  if (data.length === 0) refuse('no image data');
  const bpp = BYTES[colourType];
  const expected = height * (width * bpp + 1);
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 });
  } catch {
    refuse('the image data does not inflate');
  }
  if (raw.length !== expected) refuse('the image data is the wrong length');
  const rgba = unfilter(raw, width, height, bpp);
  const size = Buffer.alloc(8);
  size.writeUInt32BE(width, 0);
  size.writeUInt32BE(height, 4);
  return crypto.createHash('sha256').update(size).update(rgba).digest('hex');
}
