'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { pathToFileUrl, readPngStats, visualIssue } = require('../scripts/smoke-demo-visuals');

test('visual smoke PNG reader detects dimensions and color diversity', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echogrid-png-'));
  try {
    const file = path.join(tmp, 'sample.png');
    writeRgbPng(file, 4, 2, [
      [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0],
      [0, 255, 255], [255, 0, 255], [20, 20, 20], [240, 240, 240],
    ]);

    const stats = readPngStats(file);
    assert.equal(stats.width, 4);
    assert.equal(stats.height, 2);
    assert.equal(stats.colorType, 2);
    assert.equal(stats.uniqueColors, 8);
    assert.match(pathToFileUrl(path.join(tmp, 'file with spaces.html')), /^file:\/\/\//);
    assert.match(visualIssue({ ...stats, width: 390, height: 844, size: 9000, uniqueColors: 8 }, { width: 390, height: 844 }), /too small|under-rendered/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

function writeRgbPng(file, width, height, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.from([0]));
    const row = Buffer.alloc(width * 3);
    for (let x = 0; x < width; x += 1) {
      const pixel = pixels[(y * width) + x];
      row[(x * 3)] = pixel[0];
      row[(x * 3) + 1] = pixel[1];
      row[(x * 3) + 2] = pixel[2];
    }
    rows.push(row);
  }

  const png = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type, 'ascii');
  return Buffer.concat([length, name, data, Buffer.alloc(4)]);
}
