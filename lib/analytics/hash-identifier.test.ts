import { describe, it, expect } from "vitest";
import { hashIdentifier } from "./hash-identifier";

describe("hashIdentifier", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const result = hashIdentifier("test@example.com");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces consistent output for the same input", () => {
    const a = hashIdentifier("user@example.com");
    const b = hashIdentifier("user@example.com");
    expect(a).toBe(b);
  });

  it("normalises input by trimming whitespace", () => {
    const a = hashIdentifier("  user@example.com  ");
    const b = hashIdentifier("user@example.com");
    expect(a).toBe(b);
  });

  it("normalises input by lowercasing", () => {
    const a = hashIdentifier("User@Example.COM");
    const b = hashIdentifier("user@example.com");
    expect(a).toBe(b);
  });

  it("produces different output for different inputs", () => {
    const a = hashIdentifier("alice@example.com");
    const b = hashIdentifier("bob@example.com");
    expect(a).not.toBe(b);
  });

  it("works with phone numbers", () => {
    const result = hashIdentifier("+971501234567");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[a-f0-9]{64}$/);
  });
});
