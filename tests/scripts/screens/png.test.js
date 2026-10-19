// tests/scripts/screens/png.test.js
// A page's pixels as one hash: how the PNG was written must not matter, and a PNG the reader does
// not fully understand is refused rather than hashed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pixelHash } from '../../../scripts/screens/png.js';
import { encodePng, solid, chunk } from '../../fixtures/screens/encode.js';

// A picture with some variety, so every filter has something to predict.
function picture(width, height) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set([(x * 37 + y * 11) & 0xff, (x * y + 90) & 0xff, (200 - x * 3 + y) & 0xff, 255], (y * width + x) * 4);
  }
  return pixels;
}

test('the same pixels written two ways give one hash', () => {
  const pixels = picture(9, 7);
  const plain = encodePng({ width: 9, height: 7, pixels, filter: 0, level: 0 });
  const busy = encodePng({ width: 9, height: 7, pixels, filter: (y) => y % 5, level: 9, parts: 3, extra: [['tEXt', 'Software\0a browser'], ['tIME', Buffer.alloc(7)]] });
  const rgb = encodePng({ width: 9, height: 7, pixels, colourType: 2, filter: 4 });
  assert.notDeepEqual(plain, busy);
  const hash = pixelHash(plain);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(pixelHash(busy), hash);
  // RGB is read as RGBA with full alpha.
  assert.equal(pixelHash(rgb), hash);
  for (const f of [1, 2, 3, 4]) assert.equal(pixelHash(encodePng({ width: 9, height: 7, pixels, filter: f })), hash, `filter ${f}`);
});

test('one pixel changed gives another hash', () => {
  const before = encodePng({ width: 4, height: 4, pixels: solid(4, 4, [10, 20, 30]) });
  const after = encodePng({ width: 4, height: 4, pixels: solid(4, 4, [10, 20, 30], { at: { x: 2, y: 3 }, colour: [10, 20, 31, 255] }) });
  assert.notEqual(pixelHash(before), pixelHash(after));
  // Only the alpha differs.
  const clear = encodePng({ width: 4, height: 4, pixels: solid(4, 4, [10, 20, 30], { at: { x: 0, y: 0 }, colour: [10, 20, 30, 254] }) });
  assert.notEqual(pixelHash(before), pixelHash(clear));
  // The same bytes in another shape.
  const wide = encodePng({ width: 8, height: 2, pixels: solid(8, 2, [10, 20, 30]) });
  assert.notEqual(pixelHash(before), pixelHash(wide));
});

test('an unsupported PNG is refused, not guessed', () => {
  const pixels = solid(3, 3, [1, 2, 3]);
  const good = encodePng({ width: 3, height: 3, pixels });
  const refused = {
    'bad signature': Buffer.concat([Buffer.from('not a png'), good.subarray(9)]),
    'empty': Buffer.alloc(0),
    'not a buffer': 'a string',
    '16-bit': encodePng({ width: 3, height: 3, pixels, header: { bitDepth: 16 } }),
    'palette': encodePng({ width: 3, height: 3, pixels, header: { colourType: 3 } }),
    'grey': encodePng({ width: 3, height: 3, pixels, header: { colourType: 0 } }),
    'interlaced': encodePng({ width: 3, height: 3, pixels, header: { interlace: 1 } }),
    'unknown filter': encodePng({ width: 3, height: 3, pixels, filter: 5 }),
    'too little data': encodePng({ width: 3, height: 3, pixels, header: { height: 4 } }),
    'too much data': encodePng({ width: 3, height: 3, pixels, header: { height: 2 } }),
    'zero width': encodePng({ width: 3, height: 3, pixels, header: { width: 0 } }),
    'truncated': good.subarray(0, good.length - 20),
    'no end': good.subarray(0, good.length - 12),
    'transparency key': encodePng({ width: 3, height: 3, pixels, colourType: 2, extra: [['tRNS', Buffer.alloc(6)]] }),
    'no image data': Buffer.concat([good.subarray(0, 33), chunk('IEND')]),
  };
  for (const [name, png] of Object.entries(refused)) assert.throws(() => pixelHash(png), /PNG/, name);
  assert.doesNotThrow(() => pixelHash(good));
});
