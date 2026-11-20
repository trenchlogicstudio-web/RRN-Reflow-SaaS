// Copyright (c) 2026 Miloš Petrović (Trench Logic Studio) · SPDX-License-Identifier: MIT
// QR Code generator for the salon's poster: byte mode, error correction level M,
// versions 1–10 (up to 213 bytes, far more than any page address needs).
// Implements ISO/IEC 18004; written for this app so nothing is loaded from elsewhere.

// Error correction codewords per block, and number of blocks, for level M (index = version).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_BITS_M = 0; // level M is encoded as 00

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver) {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const size = ver * 4 + 17;
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let i = 0, pos = size - 7; i < numAlign - 1; i++, pos -= step) result.splice(1, 0, pos);
  return result;
}

/* Reed–Solomon over GF(2^8) with the QR polynomial 0x11D. */
function rsMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => {
      result[i] ^= rsMultiply(coef, factor);
    });
  }
  return result;
}

function addEccAndInterleave(data, ver) {
  const numBlocks = NUM_BLOCKS[ver];
  const blockEccLen = ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(block[i]);
    });
  }
  return result;
}

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** QR matrix for a text: array of rows, true = dark module. */
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let ver = 1;
  for (; ver <= 10; ver++) {
    const needed = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
    if (needed <= numDataCodewords(ver) * 8) break;
  }
  if (ver > 10) throw new Error('QR: text is too long for this generator');

  // Data bits: byte mode, length, payload, terminator, padding.
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = numDataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    dataCodewords.push(v);
  }
  const codewords = addEccAndInterleave(dataCodewords, ver);

  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFixed = (x, y, dark) => {
    modules[y][x] = dark;
    fixed[y][x] = true;
  };

  const drawFormatBits = (mask) => {
    const data = (FORMAT_BITS_M << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fmt = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFixed(8, i, getBit(fmt, i));
    setFixed(8, 7, getBit(fmt, 6));
    setFixed(8, 8, getBit(fmt, 7));
    setFixed(7, 8, getBit(fmt, 8));
    for (let i = 9; i < 15; i++) setFixed(14 - i, 8, getBit(fmt, i));
    for (let i = 0; i < 8; i++) setFixed(size - 1 - i, 8, getBit(fmt, i));
    for (let i = 8; i < 15; i++) setFixed(8, size - 15 + i, getBit(fmt, i));
    setFixed(8, size - 8, true);
  };

  // Function patterns: timing, finders, alignment, format area, version.
  for (let i = 0; i < size; i++) {
    setFixed(6, i, i % 2 === 0);
    setFixed(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFixed(x, y, dist !== 2 && dist !== 4);
      }
    }
  }
  const align = alignmentPositions(ver);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) setFixed(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }
  drawFormatBits(0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const verBits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(verBits, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFixed(a, b, bit);
      setFixed(b, a, bit);
    }
  }

  // Codewords in the zig-zag order, skipping the vertical timing column.
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!fixed[y][x] && bitIndex < codewords.length * 8) {
          modules[y][x] = getBit(codewords[bitIndex >>> 3], 7 - (bitIndex & 7));
          bitIndex++;
        }
      }
    }
  }

  const applyMask = (mask) => {
    const fn = MASKS[mask];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) if (!fixed[y][x] && fn(x, y)) modules[y][x] = !modules[y][x];
    }
  };

  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask);
    drawFormatBits(mask);
    const score = penalty(modules, size);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(mask); // XOR again to undo
  }
  applyMask(bestMask);
  drawFormatBits(bestMask);
  return modules;
}

/* Penalty rules from the standard, used only to pick the most readable mask. */
function penalty(m, size) {
  let result = 0;
  const addHistory = (run, history) => {
    if (history[0] === 0) run += size;
    history.pop();
    history.unshift(run);
  };
  const countPatterns = (h) => {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  };
  const terminate = (color, run, history) => {
    if (color) {
      addHistory(run, history);
      run = 0;
    }
    run += size;
    addHistory(run, history);
    return countPatterns(history);
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let color = false;
      let run = 0;
      const history = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const cell = pass === 0 ? m[a][b] : m[b][a];
        if (cell === color) {
          run++;
          if (run === 5) result += 3;
          else if (run > 5) result++;
        } else {
          addHistory(run, history);
          if (!color) result += countPatterns(history) * 40;
          color = cell;
          run = 1;
        }
      }
      result += terminate(color, run, history) * 40;
    }
  }
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += 3;
    }
  }
  let dark = 0;
  for (const row of m) for (const c of row) if (c) dark++;
  const total = size * size;
  result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return result;
}

/** SVG of a QR code with a quiet zone, scalable to any print size. */
export function qrSvg(text, { margin = 4, title = '' } = {}) {
  const m = qrMatrix(text);
  const size = m.length + margin * 2;
  let path = '';
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; ) {
      if (!m[y][x]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < m.length && m[y][x + run]) run++;
      path += `M${x + margin} ${y + margin}h${run}v1h-${run}z`;
      x += run;
    }
  }
  const label = title ? `<title>${title.replace(/[<>&"]/g, '')}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img">${label}<rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
