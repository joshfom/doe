/**
 * Minimal QR code generator for UTM builder.
 * Generates a QR code as an SVG string using a simple encoding approach.
 * Supports alphanumeric mode for URLs up to ~2000 chars.
 *
 * This is a lightweight implementation that creates a data matrix
 * representation suitable for QR code display.
 */

// Reed-Solomon and QR encoding is complex — for a production-ready solution
// we use a compact implementation based on the QR code specification.
// This generates a valid QR code SVG for URLs.

const EC_LEVEL = 1; // L = 0, M = 1, Q = 2, H = 3

// Galois field arithmetic for GF(256)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function initGaloisField() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = x << 1;
    if (x & 256) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function polyMul(p1: number[], p2: number[]): number[] {
  const result = new Array(p1.length + p2.length - 1).fill(0);
  for (let i = 0; i < p1.length; i++) {
    for (let j = 0; j < p2.length; j++) {
      result[i + j] ^= gfMul(p1[i], p2[j]);
    }
  }
  return result;
}

function polyRemainder(dividend: number[], divisor: number[]): number[] {
  const result = [...dividend];
  for (let i = 0; i < dividend.length - divisor.length + 1; i++) {
    if (result[i] === 0) continue;
    for (let j = 1; j < divisor.length; j++) {
      result[i + j] ^= gfMul(divisor[j], result[i]);
    }
  }
  return result.slice(dividend.length - divisor.length + 1);
}

function getGeneratorPoly(ecCount: number): number[] {
  let g = [1];
  for (let i = 0; i < ecCount; i++) {
    g = polyMul(g, [1, GF_EXP[i]]);
  }
  return g;
}

// QR code version/capacity tables (byte mode, EC level M)
const VERSION_CAPACITY: number[] = [
  0, 16, 28, 44, 64, 86, 108, 124, 154, 182, 216, 254, 290, 334, 365, 415,
  453, 507, 563, 627, 669, 714, 782, 860, 914, 1000, 1062, 1128, 1193, 1267,
  1373, 1455, 1541, 1631, 1725, 1812, 1914, 1992, 2102, 2216, 2334,
];

// EC codewords per block for each version at EC level M
const EC_CODEWORDS_PER_BLOCK: number[] = [
  0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24,
  28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28,
];

// Number of EC blocks for each version at EC level M
const NUM_EC_BLOCKS: number[][] = [
  [], // version 0 doesn't exist
  [1], [1], [1], [2], [2], [2], [2], [2], [2], [2, 2],
  [4], [2, 2], [4], [3, 1], [4, 1], [4, 1], [4, 2], [4, 2], [3, 4], [3, 5],
  [4, 4], [2, 7], [4, 5], [6, 4], [8, 4], [10, 2], [8, 4], [3, 10], [7, 7], [5, 10],
  [13, 3], [17], [17, 1], [13, 6], [12, 7], [6, 14], [17, 4], [4, 18], [20, 4], [19, 6],
];

function getVersion(dataLength: number): number {
  for (let v = 1; v <= 40; v++) {
    if (VERSION_CAPACITY[v] >= dataLength) return v;
  }
  return 40;
}

function getSize(version: number): number {
  return 17 + version * 4;
}

// Encode data in byte mode
function encodeData(text: string, version: number): number[] {
  const bytes = new TextEncoder().encode(text);
  const totalDataCodewords = VERSION_CAPACITY[version] + (version >= 10 ? 2 : 0);

  // Mode indicator (0100 = byte mode) + character count
  const bits: number[] = [];

  // Mode: byte (0100)
  bits.push(0, 1, 0, 0);

  // Character count indicator
  const countBits = version >= 10 ? 16 : 8;
  for (let i = countBits - 1; i >= 0; i--) {
    bits.push((bytes.length >> i) & 1);
  }

  // Data
  for (const byte of bytes) {
    for (let i = 7; i >= 0; i--) {
      bits.push((byte >> i) & 1);
    }
  }

  // Terminator
  const totalBits = getTotalDataBits(version);
  while (bits.length < totalBits && bits.length < bits.length + 4) {
    bits.push(0);
  }

  // Pad to byte boundary
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // Pad bytes
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < totalBits) {
    const pb = padBytes[padIdx % 2];
    for (let i = 7; i >= 0; i--) {
      bits.push((pb >> i) & 1);
    }
    padIdx++;
  }

  // Convert to codewords
  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let val = 0;
    for (let j = 0; j < 8 && i + j < bits.length; j++) {
      val = (val << 1) | bits[i + j];
    }
    codewords.push(val);
  }

  return codewords;
}

function getTotalDataBits(version: number): number {
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[version];
  const blocks = NUM_EC_BLOCKS[version];
  const totalBlocks = blocks.reduce((a, b) => a + b, 0);
  const totalCodewords = getModuleCount(version);
  const totalEcCodewords = totalBlocks * ecPerBlock;
  return (totalCodewords - totalEcCodewords) * 8;
}

function getModuleCount(version: number): number {
  // Total number of codewords in the QR code
  const size = getSize(version);
  let modules = size * size;
  // Subtract function patterns
  modules -= 3 * 64 + 3 * 15 + 1; // finder patterns + separators + dark module
  modules -= 2 * (size - 16); // timing patterns
  if (version >= 2) {
    const alignCount = Math.floor(version / 7) + 2;
    const alignPatterns = alignCount * alignCount - 3;
    modules -= alignPatterns * 25;
  }
  if (version >= 7) {
    modules -= 36; // version info
  }
  modules -= 31; // format info
  return Math.floor(modules / 8);
}

/**
 * Generate a QR code as an SVG string.
 * Uses a simplified approach suitable for URL encoding.
 */
export function generateQRCodeSVG(text: string, size: number = 200): string {
  const modules = generateQRMatrix(text);
  const moduleCount = modules.length;
  const cellSize = size / (moduleCount + 8); // Add quiet zone
  const offset = cellSize * 4; // 4-module quiet zone

  let paths = '';
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (modules[row][col]) {
        const x = offset + col * cellSize;
        const y = offset + row * cellSize;
        paths += `M${x},${y}h${cellSize}v${cellSize}h-${cellSize}z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
<rect width="${size}" height="${size}" fill="white"/>
<path d="${paths}" fill="black"/>
</svg>`;
}

/**
 * Generate the QR code module matrix.
 * Returns a 2D boolean array where true = dark module.
 */
function generateQRMatrix(text: string): boolean[][] {
  const version = getVersion(new TextEncoder().encode(text).length);
  const size = getSize(version);

  // Create matrix
  const matrix: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );
  const reserved: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );

  // Place finder patterns
  placeFinder(matrix, reserved, 0, 0);
  placeFinder(matrix, reserved, size - 7, 0);
  placeFinder(matrix, reserved, 0, size - 7);

  // Place alignment patterns
  if (version >= 2) {
    const positions = getAlignmentPositions(version);
    for (const row of positions) {
      for (const col of positions) {
        // Skip if overlapping with finder patterns
        if (row < 9 && col < 9) continue;
        if (row < 9 && col > size - 9) continue;
        if (row > size - 9 && col < 9) continue;
        placeAlignment(matrix, reserved, row, col);
      }
    }
  }

  // Place timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    reserved[6][i] = true;
    matrix[i][6] = i % 2 === 0;
    reserved[i][6] = true;
  }

  // Reserve format info areas
  for (let i = 0; i < 8; i++) {
    reserved[8][i] = true;
    reserved[8][size - 1 - i] = true;
    reserved[i][8] = true;
    reserved[size - 1 - i][8] = true;
  }
  reserved[8][8] = true;

  // Dark module
  matrix[size - 8][8] = true;
  reserved[size - 8][8] = true;

  // Reserve version info areas
  if (version >= 7) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        reserved[i][size - 11 + j] = true;
        reserved[size - 11 + j][i] = true;
      }
    }
  }

  // Encode and place data
  const dataCodewords = encodeData(text, version);
  const ecPerBlock = EC_CODEWORDS_PER_BLOCK[version];
  const blocks = NUM_EC_BLOCKS[version];

  // Split into blocks and compute EC
  const allData: number[][] = [];
  const allEc: number[][] = [];
  let dataIdx = 0;

  const totalBlocks = blocks.reduce((a, b) => a + b, 0);
  const totalCodewords = getModuleCount(version);
  const totalEcCodewords = totalBlocks * ecPerBlock;
  const totalDataCodewords = totalCodewords - totalEcCodewords;
  const shortBlockDataCount = Math.floor(totalDataCodewords / totalBlocks);

  let blockIdx = 0;
  for (let g = 0; g < blocks.length; g++) {
    const count = blocks[g];
    const blockDataCount = shortBlockDataCount + g;
    for (let b = 0; b < count; b++) {
      const blockData = dataCodewords.slice(dataIdx, dataIdx + blockDataCount);
      dataIdx += blockDataCount;
      allData.push(blockData);

      // Compute EC codewords
      const gen = getGeneratorPoly(ecPerBlock);
      const msgPoly = [...blockData, ...new Array(ecPerBlock).fill(0)];
      const ec = polyRemainder(msgPoly, gen);
      allEc.push(ec);
      blockIdx++;
    }
  }

  // Interleave data codewords
  const interleaved: number[] = [];
  const maxDataLen = Math.max(...allData.map((d) => d.length));
  for (let i = 0; i < maxDataLen; i++) {
    for (const block of allData) {
      if (i < block.length) interleaved.push(block[i]);
    }
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const ec of allEc) {
      if (i < ec.length) interleaved.push(ec[i]);
    }
  }

  // Convert to bits
  const dataBits: number[] = [];
  for (const cw of interleaved) {
    for (let i = 7; i >= 0; i--) {
      dataBits.push((cw >> i) & 1);
    }
  }

  // Place data bits in zigzag pattern
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // Skip timing column
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const row = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (row < 0 || row >= size || col < 0 || col >= size) continue;
        if (reserved[row][col]) continue;
        if (bitIdx < dataBits.length) {
          matrix[row][col] = dataBits[bitIdx] === 1;
          bitIdx++;
        }
      }
    }
  }

  // Apply mask (mask 0: (row + col) % 2 === 0)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!reserved[row][col] && (row + col) % 2 === 0) {
        matrix[row][col] = !matrix[row][col];
      }
    }
  }

  // Place format info
  const formatBits = getFormatBits(EC_LEVEL, 0);
  placeFormatBits(matrix, formatBits, size);

  // Place version info
  if (version >= 7) {
    placeVersionBits(matrix, version, size);
  }

  return matrix;
}

function placeFinder(
  matrix: boolean[][],
  reserved: boolean[][],
  row: number,
  col: number
) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const mr = row + r;
      const mc = col + c;
      if (mr < 0 || mr >= matrix.length || mc < 0 || mc >= matrix.length) continue;
      const isOuter = r === -1 || r === 7 || c === -1 || c === 7;
      const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
      const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      matrix[mr][mc] = !isOuter && (isBorder || isInner);
      reserved[mr][mc] = true;
    }
  }
}

function placeAlignment(
  matrix: boolean[][],
  reserved: boolean[][],
  centerRow: number,
  centerCol: number
) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const mr = centerRow + r;
      const mc = centerCol + c;
      const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
      const isCenter = r === 0 && c === 0;
      matrix[mr][mc] = isBorder || isCenter;
      reserved[mr][mc] = true;
    }
  }
}

function getAlignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const size = getSize(version);
  const intervals = Math.floor(version / 7) + 1;
  const step = Math.ceil((size - 13) / intervals / 2) * 2;
  const positions = [6];
  let pos = size - 7;
  while (positions.length <= intervals) {
    positions.splice(1, 0, pos);
    pos -= step;
  }
  return positions;
}

function getFormatBits(ecLevel: number, mask: number): number[] {
  const FORMAT_INFO = [
    0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0,
    0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976,
    0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b,
    0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed,
  ];
  const idx = ecLevel * 8 + mask;
  const info = FORMAT_INFO[idx];
  const bits: number[] = [];
  for (let i = 14; i >= 0; i--) {
    bits.push((info >> i) & 1);
  }
  return bits;
}

function placeFormatBits(matrix: boolean[][], bits: number[], size: number) {
  // Around top-left finder
  const positions1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    matrix[positions1[i][0]][positions1[i][1]] = bits[i] === 1;
  }

  // Around other finders
  const positions2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
    [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [8, size - 8], [8, size - 7], [8, size - 6], [8, size - 5],
    [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  for (let i = 0; i < 15; i++) {
    matrix[positions2[i][0]][positions2[i][1]] = bits[i] === 1;
  }
}

function placeVersionBits(matrix: boolean[][], version: number, size: number) {
  const VERSION_INFO = [
    0, 0, 0, 0, 0, 0, 0,
    0x07c94, 0x085bc, 0x09a99, 0x0a4d3, 0x0bbf6, 0x0c762, 0x0d847, 0x0e60d,
    0x0f928, 0x10b78, 0x1145d, 0x12a17, 0x13532, 0x149a6, 0x15683, 0x168c9,
    0x177ec, 0x18ec4, 0x191e1, 0x1afab, 0x1b08e, 0x1cc1a, 0x1d33f, 0x1ed75,
    0x1f250, 0x209d5, 0x216f0, 0x228ba, 0x2379f, 0x24b0b, 0x2542e, 0x26a64,
    0x27541, 0x28c69,
  ];
  if (version < 7) return;
  const info = VERSION_INFO[version];
  for (let i = 0; i < 18; i++) {
    const bit = (info >> i) & 1;
    const row = Math.floor(i / 3);
    const col = size - 11 + (i % 3);
    matrix[row][col] = bit === 1;
    matrix[col][row] = bit === 1;
  }
}
