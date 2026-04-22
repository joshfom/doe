import { describe, it, expect, afterEach } from "vitest";
import {
  LocalStorageBackend,
  S3StorageBackend,
  R2StorageBackend,
  createStorageBackend,
  type StorageBackend,
} from "./storage";
import { existsSync, rmSync } from "fs";
import path from "path";

describe("LocalStorageBackend", () => {
  let backend: LocalStorageBackend;
  const testFilenames: string[] = [];

  beforeEach(() => {
    backend = new LocalStorageBackend();
  });

  afterEach(() => {
    // Clean up any test files created
    for (const filename of testFilenames) {
      const filePath = path.join(process.cwd(), "public", "uploads", filename);
      if (existsSync(filePath)) {
        rmSync(filePath);
      }
    }
    testFilenames.length = 0;
  });

  it("upload writes file and returns correct public URL", async () => {
    const filename = `__test_upload_${Date.now()}.txt`;
    testFilenames.push(filename);

    const file = Buffer.from("test-content");
    const url = await backend.upload(file, filename, "text/plain");

    expect(url).toBe(`/uploads/${filename}`);

    const filePath = path.join(process.cwd(), "public", "uploads", filename);
    expect(existsSync(filePath)).toBe(true);
  });

  it("delete removes the file from disk", async () => {
    const filename = `__test_delete_${Date.now()}.txt`;
    testFilenames.push(filename);

    const file = Buffer.from("to-be-deleted");
    await backend.upload(file, filename, "text/plain");

    const filePath = path.join(process.cwd(), "public", "uploads", filename);
    expect(existsSync(filePath)).toBe(true);

    await backend.delete(`/uploads/${filename}`);
    expect(existsSync(filePath)).toBe(false);
  });
});

describe("S3StorageBackend", () => {
  it("upload throws not configured error", async () => {
    const backend = new S3StorageBackend();
    await expect(
      backend.upload(Buffer.from("data"), "file.jpg", "image/jpeg")
    ).rejects.toThrow("S3 storage not yet configured");
  });

  it("delete throws not configured error", async () => {
    const backend = new S3StorageBackend();
    await expect(backend.delete("/some/url")).rejects.toThrow(
      "S3 storage not yet configured"
    );
  });
});

describe("R2StorageBackend", () => {
  it("upload throws not configured error", async () => {
    const backend = new R2StorageBackend();
    await expect(
      backend.upload(Buffer.from("data"), "file.jpg", "image/jpeg")
    ).rejects.toThrow("R2 storage not yet configured");
  });

  it("delete throws not configured error", async () => {
    const backend = new R2StorageBackend();
    await expect(backend.delete("/some/url")).rejects.toThrow(
      "R2 storage not yet configured"
    );
  });
});

describe("createStorageBackend", () => {
  const originalEnv = process.env.STORAGE_BACKEND;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.STORAGE_BACKEND;
    } else {
      process.env.STORAGE_BACKEND = originalEnv;
    }
  });

  it("returns S3StorageBackend when env is 's3'", () => {
    process.env.STORAGE_BACKEND = "s3";
    expect(createStorageBackend()).toBeInstanceOf(S3StorageBackend);
  });

  it("returns R2StorageBackend when env is 'r2'", () => {
    process.env.STORAGE_BACKEND = "r2";
    expect(createStorageBackend()).toBeInstanceOf(R2StorageBackend);
  });

  it("returns LocalStorageBackend when env is undefined", () => {
    delete process.env.STORAGE_BACKEND;
    expect(createStorageBackend()).toBeInstanceOf(LocalStorageBackend);
  });

  it("returns LocalStorageBackend when env is 'local'", () => {
    process.env.STORAGE_BACKEND = "local";
    expect(createStorageBackend()).toBeInstanceOf(LocalStorageBackend);
  });

  it("returns LocalStorageBackend for any unrecognized value", () => {
    process.env.STORAGE_BACKEND = "gcs";
    expect(createStorageBackend()).toBeInstanceOf(LocalStorageBackend);
  });

  it("returned backend implements StorageBackend interface", () => {
    delete process.env.STORAGE_BACKEND;
    const backend: StorageBackend = createStorageBackend();
    expect(typeof backend.upload).toBe("function");
    expect(typeof backend.delete).toBe("function");
  });
});
