import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import {
  clampSize,
  persistSize,
  loadPersistedSize,
  computeResizeDelta,
  MIN_WIDTH,
  MIN_HEIGHT,
  MAX_VIEWPORT_RATIO,
  STORAGE_KEY,
} from '../ChatWidget';
import type { ResizeDirection } from '../ChatWidget';

// ── Property 1: clampSize output always satisfies min/max constraints ────────
// **Validates: Requirements 1.2**

describe('clampSize', () => {
  it('output always satisfies min/max constraints for arbitrary positive inputs', () => {
    fc.assert(
      fc.property(
        fc.float({ min: 1, noNaN: true, noDefaultInfinity: true }),
        fc.float({ min: 1, noNaN: true, noDefaultInfinity: true }),
        fc.float({ min: 1, noNaN: true, noDefaultInfinity: true }),
        fc.float({ min: 1, noNaN: true, noDefaultInfinity: true }),
        (width, height, viewportWidth, viewportHeight) => {
          const result = clampSize(width, height, viewportWidth, viewportHeight);
          const maxW = Math.floor(viewportWidth * MAX_VIEWPORT_RATIO);
          const maxH = Math.floor(viewportHeight * MAX_VIEWPORT_RATIO);

          // Width is at least MIN_WIDTH
          expect(result.width).toBeGreaterThanOrEqual(MIN_WIDTH);
          // Height is at least MIN_HEIGHT
          expect(result.height).toBeGreaterThanOrEqual(MIN_HEIGHT);
          // Width does not exceed max (but minimum takes precedence)
          expect(result.width).toBeLessThanOrEqual(Math.max(MIN_WIDTH, maxW));
          // Height does not exceed max (but minimum takes precedence)
          expect(result.height).toBeLessThanOrEqual(Math.max(MIN_HEIGHT, maxH));
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ── Property 2: persistSize → loadPersistedSize round-trip ───────────────────
// **Validates: Requirements 2.6, 2.7**

describe('persistSize / loadPersistedSize round-trip', () => {
  let originalLocalStorage: Storage;

  beforeEach(() => {
    // Use a simple in-memory localStorage mock
    originalLocalStorage = globalThis.localStorage;
    const store: Record<string, string> = {};
    const mock: Storage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => { store[key] = value; },
      removeItem: (key: string) => { delete store[key]; },
      clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
      get length() { return Object.keys(store).length; },
      key: (index: number) => Object.keys(store)[index] ?? null,
    };
    Object.defineProperty(globalThis, 'localStorage', { value: mock, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: originalLocalStorage, writable: true, configurable: true });
  });

  it('round-trip returns equivalent size for arbitrary positive integer pairs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10000 }),
        fc.integer({ min: 1, max: 10000 }),
        (width, height) => {
          const size = { width, height };
          persistSize(size);
          const loaded = loadPersistedSize();
          expect(loaded).not.toBeNull();
          expect(loaded!.width).toBe(width);
          expect(loaded!.height).toBe(height);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('returns null when localStorage is empty', () => {
    const result = loadPersistedSize();
    expect(result).toBeNull();
  });

  it('returns null when localStorage contains invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{');
    const result = loadPersistedSize();
    expect(result).toBeNull();
  });

  it('returns null when stored object is missing width or height', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ width: 400 }));
    expect(loadPersistedSize()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ height: 600 }));
    expect(loadPersistedSize()).toBeNull();

    localStorage.setItem(STORAGE_KEY, JSON.stringify({ width: 'abc', height: 600 }));
    expect(loadPersistedSize()).toBeNull();
  });
});

// ── Property 3: Resize delta direction correctness ───────────────────────────
// **Validates: Requirements 2.2, 6.2**

describe('computeResizeDelta', () => {
  // Use a large viewport so clamping doesn't interfere with direction tests
  const viewportWidth = 2000;
  const viewportHeight = 2000;

  // Generators for start sizes within a reasonable range above minimums
  const startWidthArb = fc.integer({ min: MIN_WIDTH, max: 800 });
  const startHeightArb = fc.integer({ min: MIN_HEIGHT, max: 800 });
  // Deltas that are small enough to stay within clamp range
  const deltaArb = fc.integer({ min: -100, max: 100 });

  it('top drag changes only height, width stays the same', () => {
    fc.assert(
      fc.property(
        startWidthArb,
        startHeightArb,
        deltaArb,
        deltaArb,
        (startWidth, startHeight, deltaX, deltaY) => {
          const result = computeResizeDelta(
            'top',
            false,
            deltaX,
            deltaY,
            startWidth,
            startHeight,
            viewportWidth,
            viewportHeight
          );

          // Width must remain unchanged (clamped to same value since startWidth is already valid)
          expect(result.width).toBe(startWidth);
          // Height should change based on deltaY (unless clamped)
          const expectedHeight = Math.max(MIN_HEIGHT, Math.min(startHeight - deltaY, Math.floor(viewportHeight * MAX_VIEWPORT_RATIO)));
          expect(result.height).toBe(expectedHeight);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('side drag changes only width, height stays the same', () => {
    fc.assert(
      fc.property(
        startWidthArb,
        startHeightArb,
        deltaArb,
        deltaArb,
        (startWidth, startHeight, deltaX, deltaY) => {
          const result = computeResizeDelta(
            'side',
            false,
            deltaX,
            deltaY,
            startWidth,
            startHeight,
            viewportWidth,
            viewportHeight
          );

          // Height must remain unchanged
          expect(result.height).toBe(startHeight);
          // Width should change based on deltaX (LTR: width = startWidth - deltaX)
          const expectedWidth = Math.max(MIN_WIDTH, Math.min(startWidth - deltaX, Math.floor(viewportWidth * MAX_VIEWPORT_RATIO)));
          expect(result.width).toBe(expectedWidth);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('corner drag can change both width and height', () => {
    fc.assert(
      fc.property(
        startWidthArb,
        startHeightArb,
        deltaArb,
        deltaArb,
        (startWidth, startHeight, deltaX, deltaY) => {
          const result = computeResizeDelta(
            'corner',
            false,
            deltaX,
            deltaY,
            startWidth,
            startHeight,
            viewportWidth,
            viewportHeight
          );

          const expectedWidth = Math.max(MIN_WIDTH, Math.min(startWidth - deltaX, Math.floor(viewportWidth * MAX_VIEWPORT_RATIO)));
          const expectedHeight = Math.max(MIN_HEIGHT, Math.min(startHeight - deltaY, Math.floor(viewportHeight * MAX_VIEWPORT_RATIO)));
          expect(result.width).toBe(expectedWidth);
          expect(result.height).toBe(expectedHeight);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('RTL inverts horizontal delta compared to LTR for side drag', () => {
    fc.assert(
      fc.property(
        startWidthArb,
        startHeightArb,
        deltaArb,
        (startWidth, startHeight, deltaX) => {
          const ltrResult = computeResizeDelta(
            'side',
            false,
            deltaX,
            0,
            startWidth,
            startHeight,
            viewportWidth,
            viewportHeight
          );

          const rtlResult = computeResizeDelta(
            'side',
            true,
            deltaX,
            0,
            startWidth,
            startHeight,
            viewportWidth,
            viewportHeight
          );

          // LTR: newWidth = startWidth - deltaX
          // RTL: newWidth = startWidth + deltaX
          // So for the same positive deltaX, RTL width should be larger than LTR width
          // (unless clamped). We verify the formulas produce expected values.
          const expectedLtr = Math.max(MIN_WIDTH, Math.min(startWidth - deltaX, Math.floor(viewportWidth * MAX_VIEWPORT_RATIO)));
          const expectedRtl = Math.max(MIN_WIDTH, Math.min(startWidth + deltaX, Math.floor(viewportWidth * MAX_VIEWPORT_RATIO)));
          expect(ltrResult.width).toBe(expectedLtr);
          expect(rtlResult.width).toBe(expectedRtl);

          // Both should have the same height (unchanged)
          expect(ltrResult.height).toBe(startHeight);
          expect(rtlResult.height).toBe(startHeight);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('RTL inverts horizontal delta compared to LTR for corner drag', () => {
    fc.assert(
      fc.property(
        startWidthArb,
        startHeightArb,
        deltaArb,
        deltaArb,
        (startWidth, startHeight, deltaX, deltaY) => {
          const ltrResult = computeResizeDelta(
            'corner',
            false,
            deltaX,
            deltaY,
            startWidth,
            startHeight,
            viewportWidth,
            viewportHeight
          );

          const rtlResult = computeResizeDelta(
            'corner',
            true,
            deltaX,
            deltaY,
            startWidth,
            startHeight,
            viewportWidth,
            viewportHeight
          );

          // Width: LTR uses (startWidth - deltaX), RTL uses (startWidth + deltaX)
          const expectedLtrW = Math.max(MIN_WIDTH, Math.min(startWidth - deltaX, Math.floor(viewportWidth * MAX_VIEWPORT_RATIO)));
          const expectedRtlW = Math.max(MIN_WIDTH, Math.min(startWidth + deltaX, Math.floor(viewportWidth * MAX_VIEWPORT_RATIO)));
          expect(ltrResult.width).toBe(expectedLtrW);
          expect(rtlResult.width).toBe(expectedRtlW);

          // Height should be the same for both LTR and RTL (not affected by RTL)
          expect(ltrResult.height).toBe(rtlResult.height);
        }
      ),
      { numRuns: 200 }
    );
  });
});
