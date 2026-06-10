import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encrypt, decrypt } from "./encryption";

// A valid 64-char hex key (32 bytes)
const TEST_KEY =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("lib/analytics/encryption", () => {
  beforeEach(() => {
    process.env.ANALYTICS_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    delete process.env.ANALYTICS_ENCRYPTION_KEY;
  });

  it("encrypts and decrypts a plaintext string", () => {
    const plaintext = "EAAxxxxxxx_my_secret_token_12345";
    const ciphertext = encrypt(plaintext);

    // Ciphertext should be different from plaintext
    expect(ciphertext).not.toBe(plaintext);

    // Decryption should return original
    const decrypted = decrypt(ciphertext);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", () => {
    const plaintext = "same_input";
    const c1 = encrypt(plaintext);
    const c2 = encrypt(plaintext);

    // Due to random IV, ciphertexts should differ
    expect(c1).not.toBe(c2);

    // Both should decrypt to the same value
    expect(decrypt(c1)).toBe(plaintext);
    expect(decrypt(c2)).toBe(plaintext);
  });

  it("handles empty string", () => {
    const plaintext = "";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe("");
  });

  it("handles unicode content", () => {
    const plaintext = "مرحبا بالعالم 🌍";
    const ciphertext = encrypt(plaintext);
    expect(decrypt(ciphertext)).toBe(plaintext);
  });

  it("throws if ANALYTICS_ENCRYPTION_KEY is missing", () => {
    delete process.env.ANALYTICS_ENCRYPTION_KEY;
    expect(() => encrypt("test")).toThrow(
      "ANALYTICS_ENCRYPTION_KEY must be a 64-character hex string"
    );
  });

  it("throws if ANALYTICS_ENCRYPTION_KEY is wrong length", () => {
    process.env.ANALYTICS_ENCRYPTION_KEY = "tooshort";
    expect(() => encrypt("test")).toThrow(
      "ANALYTICS_ENCRYPTION_KEY must be a 64-character hex string"
    );
  });

  it("throws on tampered ciphertext", () => {
    const plaintext = "sensitive_data";
    const ciphertext = encrypt(plaintext);

    // Tamper with the ciphertext
    const buf = Buffer.from(ciphertext, "base64");
    buf[buf.length - 1] ^= 0xff; // flip bits in auth tag
    const tampered = buf.toString("base64");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on invalid ciphertext (too short)", () => {
    expect(() => decrypt("dG9vc2hvcnQ=")).toThrow("Invalid ciphertext: too short");
  });
});
