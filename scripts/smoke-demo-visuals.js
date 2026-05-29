#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');

const PAGES = [
  {
    label: 'index',
    file: 'index.html',
    requiredText: ['EchoGrid Demo Index', 'Competition Verdict', '90-Second Runbook', 'Leaderboard Snapshot'],
  },
  {
    label: 'mission-control',
    file: 'mission-control.html',
    requiredText: ['EchoGrid Mission Control', 'Judge Briefing', 'Route Playback', 'Strategy Edge'],
  },
  {
    label: 'replay',
    file: 'replay.html',
    requiredText: ['EchoGrid Replay', 'Score Curve', 'Key Events'],
  },
  {
    label: 'arena',
    file: 'arena.html',
    requiredText: ['EchoGrid Arena', 'Aggregate Table', 'Per-Seed Matrix'],
  },
];

const VIEWPORTS = [
  { label: 'desktop', width: 1365, height: 900 },
  { label: 'mobile', width: 390, height: 844 },
];

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const showcaseDir = resolvePath(options._[0] || './logs/showcase');
  const outDir = resolvePath(options.out || path.join(showcaseDir, 'screenshots'));
  const browser = findBrowser(options.browser);
  const pages = PAGES.map((page) => ({
    ...page,
    source: path.join(showcaseDir, page.file),
  }));
  const results = [];
  const errors = [];

  if (!browser) {
    throw new Error('No Chromium-compatible browser found. Install Chrome, Chromium, or Edge, or pass --browser <path>.');
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  for (const page of pages) {
    verifyPageText(page, errors);
    for (const viewport of VIEWPORTS) {
      const screenshot = path.join(outDir, `${page.label}-${viewport.label}.png`);
      const rendered = renderScreenshot(browser, page.source, screenshot, viewport);
      if (!rendered.ok) {
        errors.push(rendered.error);
        continue;
      }
      const stats = readPngStats(screenshot);
      const issue = visualIssue(stats, viewport);
      if (issue) errors.push(`${displayPath(screenshot)}: ${issue}`);
      results.push({
        page: page.file,
        viewport: viewport.label,
        width: stats.width,
        height: stats.height,
        unique_colors: stats.uniqueColors,
        top_half_unique_colors: stats.topHalfUniqueColors,
        size: stats.size,
        screenshot: displayPath(screenshot),
      });
    }
  }

  const report = {
    schema: 'echogrid.visual_smoke.v1',
    generated_at: new Date().toISOString(),
    generator: 'scripts/smoke-demo-visuals.js',
    browser: displayPath(browser),
    showcase_dir: displayPath(showcaseDir),
    screenshots: results,
  };
  const reportFile = path.join(outDir, 'visual-smoke.json');
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  if (errors.length > 0) {
    process.stderr.write('DEMO VISUAL SMOKE FAILED\n');
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write('DEMO VISUAL SMOKE PASSED\n');
  process.stdout.write(`Browser: ${displayPath(browser)}\n`);
  process.stdout.write(`Report: ${displayPath(reportFile)}\n`);
  for (const item of results) {
    process.stdout.write(`- ${item.screenshot} ${item.width}x${item.height} colors=${item.unique_colors} top=${item.top_half_unique_colors}\n`);
  }
}

function verifyPageText(page, errors) {
  if (!fs.existsSync(page.source)) {
    errors.push(`missing page: ${displayPath(page.source)}`);
    return;
  }
  const html = fs.readFileSync(page.source, 'utf8');
  for (const text of page.requiredText) {
    if (!html.includes(text)) errors.push(`${displayPath(page.source)} missing "${text}"`);
  }
}

function renderScreenshot(browser, htmlFile, outFile, viewport) {
  if (!fs.existsSync(htmlFile)) {
    return { ok: false, error: `cannot screenshot missing page: ${displayPath(htmlFile)}` };
  }
  const commonArgs = [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    `--window-size=${viewport.width},${viewport.height}`,
    `--screenshot=${outFile}`,
    pathToFileUrl(htmlFile),
  ];
  let result = spawnSync(browser, ['--headless=new', ...commonArgs], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30000,
  });
  if (result.status !== 0) {
    result = spawnSync(browser, ['--headless', ...commonArgs], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    });
  }
  if (result.error) return { ok: false, error: `${displayPath(browser)} failed: ${result.error.message}` };
  if (result.status !== 0) {
    const details = `${result.stderr || ''}${result.stdout || ''}`.trim();
    return { ok: false, error: `${displayPath(browser)} screenshot failed for ${displayPath(htmlFile)}: ${details}` };
  }
  if (!fs.existsSync(outFile)) return { ok: false, error: `browser did not write ${displayPath(outFile)}` };
  return { ok: true };
}

function visualIssue(stats, viewport) {
  if (stats.width !== viewport.width || stats.height !== viewport.height) {
    return `expected ${viewport.width}x${viewport.height}, got ${stats.width}x${stats.height}`;
  }
  if (stats.size < 3000) return `screenshot too small to prove a rendered page (${stats.size} bytes)`;
  if (stats.uniqueColors < 24) return `screenshot appears blank or severely under-rendered (${stats.uniqueColors} sampled colors)`;
  if (stats.topHalfUniqueColors < 16) return `top half appears blank or severely under-rendered (${stats.topHalfUniqueColors} sampled colors)`;
  return null;
}

function findBrowser(explicit) {
  const candidates = [];
  if (explicit) candidates.push(explicit);
  if (process.env.ECHOGRID_BROWSER) candidates.push(process.env.ECHOGRID_BROWSER);
  if (process.platform === 'win32') {
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    );
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  }
  candidates.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'msedge');

  for (const candidate of candidates) {
    if (isUsableBrowser(candidate)) return candidate;
  }
  return null;
}

function isUsableBrowser(candidate) {
  if (!candidate) return false;
  if (candidate.includes(path.sep) || path.isAbsolute(candidate)) {
    return fs.existsSync(candidate);
  }
  const check = process.platform === 'win32'
    ? spawnSync('where.exe', [candidate], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    : spawnSync('sh', ['-lc', `command -v ${shellQuote(candidate)}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return check.status === 0;
}

function readPngStats(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.length < 33 || buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') {
    throw new Error(`${displayPath(file)} is not a PNG file`);
  }
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  const idat = [];

  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new Error(`${displayPath(file)} has a truncated ${type} chunk`);
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (!width || !height) throw new Error(`${displayPath(file)} missing IHDR dimensions`);
  if (bitDepth !== 8) throw new Error(`${displayPath(file)} uses unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error(`${displayPath(file)} uses unsupported PNG interlace mode ${interlace}`);
  if (!idat.length) throw new Error(`${displayPath(file)} missing IDAT data`);

  const colorStats = countUniquePngColors({
    raw: zlib.inflateSync(Buffer.concat(idat)),
    width,
    height,
    colorType,
    palette,
    file,
  });
  return {
    width,
    height,
    bitDepth,
    colorType,
    uniqueColors: colorStats.total,
    topHalfUniqueColors: colorStats.topHalf,
    size: buffer.length,
  };
}

function countUniquePngColors({ raw, width, height, colorType, palette, file }) {
  const channels = pngChannels(colorType);
  const bpp = channels;
  const stride = width * channels;
  const sampleEvery = Math.max(1, Math.floor((width * height) / 30000));
  const colors = new Set();
  const topColors = new Set();
  const topLimit = Math.max(1, Math.floor(height * 0.5));
  let rawOffset = 0;
  let previous = Buffer.alloc(stride);
  let pixelIndex = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const scan = Buffer.from(raw.subarray(rawOffset, rawOffset + stride));
    rawOffset += stride;
    if (scan.length !== stride) throw new Error(`${displayPath(file)} has a truncated scanline`);
    unfilterScanline(scan, previous, bpp, filter);
    for (let x = 0; x < width; x += 1) {
      if (pixelIndex % sampleEvery === 0) {
        const color = pixelKey(scan, x, colorType, palette);
        colors.add(color);
        if (y < topLimit) topColors.add(color);
      }
      pixelIndex += 1;
    }
    previous = scan;
  }
  return {
    total: colors.size,
    topHalf: topColors.size,
  };
}

function pngChannels(colorType) {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type ${colorType}`);
}

function unfilterScanline(scan, previous, bpp, filter) {
  for (let index = 0; index < scan.length; index += 1) {
    const left = index >= bpp ? scan[index - bpp] : 0;
    const up = previous[index] || 0;
    const upLeft = index >= bpp ? previous[index - bpp] || 0 : 0;
    let predictor = 0;
    if (filter === 1) predictor = left;
    else if (filter === 2) predictor = up;
    else if (filter === 3) predictor = Math.floor((left + up) / 2);
    else if (filter === 4) predictor = paeth(left, up, upLeft);
    else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
    scan[index] = (scan[index] + predictor) & 0xff;
  }
}

function pixelKey(scan, x, colorType, palette) {
  if (colorType === 0) {
    const gray = scan[x];
    return `${gray},${gray},${gray},255`;
  }
  if (colorType === 2) {
    const offset = x * 3;
    return `${scan[offset]},${scan[offset + 1]},${scan[offset + 2]},255`;
  }
  if (colorType === 3) {
    const index = scan[x] * 3;
    if (!palette || index + 2 >= palette.length) return '0,0,0,255';
    return `${palette[index]},${palette[index + 1]},${palette[index + 2]},255`;
  }
  if (colorType === 4) {
    const offset = x * 2;
    return `${scan[offset]},${scan[offset]},${scan[offset]},${scan[offset + 1]}`;
  }
  const offset = x * 4;
  return `${scan[offset]},${scan[offset + 1]},${scan[offset + 2]},${scan[offset + 3]}`;
}

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function parseArgs(argv) {
  const options = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

function pathToFileUrl(file) {
  const resolved = path.resolve(file).replace(/\\/g, '/');
  const prefix = resolved.startsWith('/') ? 'file://' : 'file:///';
  return encodeURI(`${prefix}${resolved}`);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function resolvePath(value) {
  return path.isAbsolute(String(value)) ? String(value) : path.resolve(root, String(value));
}

function displayPath(file) {
  if (!file) return 'unknown';
  if (!file.includes(path.sep) && !path.isAbsolute(file)) return file;
  const relative = path.relative(root, file);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative.replace(/\\/g, '/');
  return os.platform() === 'win32' ? file.replace(/\\/g, '/') : file;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  findBrowser,
  pathToFileUrl,
  readPngStats,
  visualIssue,
};
