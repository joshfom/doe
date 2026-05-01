import { mkdir, writeFile, unlink } from "fs/promises";
import path from "path";
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

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
 * AWS S3 storage backend.
 * Requires: S3_BUCKET, S3_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
 * Optional: S3_PUBLIC_URL (for custom CDN domain)
 */
export class S3StorageBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? "";
    const region = process.env.S3_REGION ?? "us-east-1";
    this.publicUrl = process.env.S3_PUBLIC_URL ?? `https://${this.bucket}.s3.${region}.amazonaws.com`;

    this.client = new S3Client({ region });
  }

  async upload(file: Buffer, filename: string, mimeType: string): Promise<string> {
    const key = `media/${filename}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: mimeType,
      })
    );

    return `${this.publicUrl}/${key}`;
  }

  async delete(url: string): Promise<void> {
    // Extract key from URL
    const key = url.replace(`${this.publicUrl}/`, "");

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }
}

/**
 * Cloudflare R2 storage backend.
 * R2 is S3-compatible, so we use the S3 SDK with a custom endpoint.
 * Requires: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 * Optional: R2_PUBLIC_URL (for public bucket or custom domain)
 */
export class R2StorageBackend implements StorageBackend {
  private client: S3Client;
  private bucket: string;
  private publicUrl: string;

  constructor() {
    const accountId = process.env.R2_ACCOUNT_ID ?? "";
    this.bucket = process.env.R2_BUCKET ?? "";
    this.publicUrl = process.env.R2_PUBLIC_URL ?? `https://${this.bucket}.${accountId}.r2.cloudflarestorage.com`;

    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
      },
    });
  }

  async upload(file: Buffer, filename: string, mimeType: string): Promise<string> {
    const key = `media/${filename}`;

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file,
        ContentType: mimeType,
      })
    );

    return `${this.publicUrl}/${key}`;
  }

  async delete(url: string): Promise<void> {
    // Extract key from URL
    const key = url.replace(`${this.publicUrl}/`, "");

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
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
