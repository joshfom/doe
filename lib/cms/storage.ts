import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";

/**
 * Abstract storage backend interface for media uploads.
 */
export interface StorageBackend {
  upload(file: Buffer, filename: string, mimeType: string): Promise<string>;
  delete(url: string): Promise<void>;
}

/**
 * Local filesystem storage backend.
 * Writes files to `public/uploads/` and returns public URL paths.
 */
export class LocalStorageBackend implements StorageBackend {
  async upload(file: Buffer, filename: string, _mimeType: string): Promise<string> {
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadsDir, { recursive: true });

    const filePath = path.join(uploadsDir, filename);
    await writeFile(filePath, file);

    return `/uploads/${filename}`;
  }

  async delete(url: string): Promise<void> {
    const filename = path.basename(url);
    const filePath = path.join(process.cwd(), "public", "uploads", filename);
    await unlink(filePath);
  }
}

/**
 * AWS S3 storage backend — stub implementation.
 */
export class S3StorageBackend implements StorageBackend {
  async upload(_file: Buffer, _filename: string, _mimeType: string): Promise<string> {
    throw new Error("S3 storage not yet configured");
  }

  async delete(_url: string): Promise<void> {
    throw new Error("S3 storage not yet configured");
  }
}

/**
 * Cloudflare R2 storage backend — stub implementation.
 */
export class R2StorageBackend implements StorageBackend {
  async upload(_file: Buffer, _filename: string, _mimeType: string): Promise<string> {
    throw new Error("R2 storage not yet configured");
  }

  async delete(_url: string): Promise<void> {
    throw new Error("R2 storage not yet configured");
  }
}

/**
 * Factory function that returns the appropriate storage backend
 * based on the `STORAGE_BACKEND` environment variable.
 */
export function createStorageBackend(): StorageBackend {
  switch (process.env.STORAGE_BACKEND) {
    case "s3":
      return new S3StorageBackend();
    case "r2":
      return new R2StorageBackend();
    default:
      return new LocalStorageBackend();
  }
}
