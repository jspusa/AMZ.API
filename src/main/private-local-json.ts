import { open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface PrivateLocalJsonPort {
  read(): Promise<unknown | null>;
  write(value: unknown, assertCurrent: () => Promise<void>): Promise<void>;
}
export type PrivateLocalJsonCodec = Readonly<{
  isAvailable(): Promise<boolean>;
  encrypt(value: string): Promise<Buffer>;
  decrypt(value: Buffer): Promise<string>;
}>;
const MAX_BYTES = 16 * 1024 * 1024;

/** Separate encrypted operational evidence; never shares the credential vault or write ledger. */
export class PrivateLocalJsonStore implements PrivateLocalJsonPort {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly input: Readonly<{ path: string; codec: PrivateLocalJsonCodec }>) {}
  async read(): Promise<unknown | null> {
    await this.queue.catch(() => undefined);
    try {
      const info = await stat(this.input.path);
      if (info.size > MAX_BYTES) throw new Error("PRIVATE_LOCAL_INVALID");
      if (!await this.input.codec.isAvailable()) throw new Error("PRIVATE_LOCAL_UNAVAILABLE");
      const bytes = await readFile(this.input.path);
      if (bytes.length > MAX_BYTES) throw new Error("PRIVATE_LOCAL_INVALID");
      const value = await this.input.codec.decrypt(bytes);
      if (Buffer.byteLength(value) > MAX_BYTES) throw new Error("PRIVATE_LOCAL_INVALID");
      return JSON.parse(value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      if (error instanceof Error && error.message === "PRIVATE_LOCAL_UNAVAILABLE") throw error;
      throw new Error("PRIVATE_LOCAL_READ_FAILED");
    }
  }
  write(value: unknown, assertCurrent: () => Promise<void>): Promise<void> {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_BYTES) return Promise.reject(new Error("PRIVATE_LOCAL_TOO_LARGE"));
    const work = this.queue.catch(() => undefined).then(async () => {
      await assertCurrent();
      if (!await this.input.codec.isAvailable()) throw new Error("PRIVATE_LOCAL_UNAVAILABLE");
      const bytes = await this.input.codec.encrypt(text);
      if (bytes.length > MAX_BYTES) throw new Error("PRIVATE_LOCAL_TOO_LARGE");
      const temporary = `${this.input.path}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, "wx", 0o600);
        try { await file.writeFile(bytes); await file.sync(); }
        finally { await file.close(); }
        await assertCurrent();
        await rename(temporary, this.input.path);
        try {
          const directory = await open(dirname(this.input.path), "r");
          try { await directory.sync(); } finally { await directory.close(); }
        } catch (error) {
          if (process.platform !== "win32" || !["EPERM", "EISDIR", "EINVAL", "ENOTSUP", "EBADF"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        }
      } finally { await rm(temporary, { force: true }).catch(() => undefined); }
    });
    this.queue = work;
    return work;
  }
}
