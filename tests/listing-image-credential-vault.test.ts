import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListingImageCredentialVault } from "../src/main/listing-image-credential-vault";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const current = async () => {};
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "amz-image-vault-test-"));
  roots.push(directory);
  const path = join(directory, "credentials.enc");
  const key = randomBytes(32);
  const codec = {
    isAvailable: vi.fn(async () => true),
    encrypt: vi.fn(async (value: string) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), bytes]);
    }),
    decrypt: vi.fn(async (value: Buffer) => {
      const decipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12));
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString("utf8");
    }),
  };
  return { path, directory, codec, vault: new ListingImageCredentialVault({ path, codec }) };
}

describe("dedicated listing image credential vault", () => {
  it("stores only encrypted password bytes privately and a new owner reads them without a plaintext cache", async () => {
    const f = await fixture();
    expect(await f.vault.hasCredentials()).toBe(false);
    await f.vault.save("fixture employee password", current);
    expect((await readFile(f.path)).includes(Buffer.from("fixture employee password"))).toBe(false);
    expect((await stat(f.path)).mode & 0o777).toBe(0o600);
    expect(await f.vault.hasCredentials()).toBe(true);
    expect(f.codec.decrypt).not.toHaveBeenCalled();
    const restored = new ListingImageCredentialVault({ path: f.path, codec: f.codec });
    expect(await restored.read(current)).toBe("fixture employee password");
    expect(await restored.read(current)).toBe("fixture employee password");
    expect(f.codec.decrypt).toHaveBeenCalledTimes(2);
    expect(await readdir(f.directory)).toEqual(["credentials.enc"]);
  });
  it("refuses read and save when OS encryption is unavailable without changing the saved ciphertext", async () => {
    const f=await fixture();
    await f.vault.save("fixture-original-password", current);
    const before=await readFile(f.path);
    f.codec.isAvailable.mockResolvedValue(false);
    await expect(f.vault.read(current)).rejects.toThrow("不會用明文");
    await expect(f.vault.save("fixture-new-password", current)).rejects.toThrow("不會用明文");
    expect(f.codec.decrypt).not.toHaveBeenCalled();
    expect(await readFile(f.path)).toEqual(before);
  });
  it("a lock while encryption is pending preserves the old vault and leaves no temporary secret files", async () => {
    const f=await fixture();
    await f.vault.save("fixture-original-password", current);
    const before=await readFile(f.path);
    const encrypt=f.codec.encrypt.getMockImplementation()!;
    let release!:()=>void;
    const pending=new Promise<void>(resolve=>{release=resolve;});
    let started!:()=>void;
    const entered=new Promise<void>(resolve=>{started=resolve;});
    f.codec.encrypt.mockImplementationOnce(async value=>{const bytes=await encrypt(value);started();await pending;return bytes;});
    let valid=true;
    const save=f.vault.save("fixture-new-password", async()=>{if(!valid)throw new Error("fixture context invalidated");});
    const rejected=expect(save).rejects.toThrow("fixture context invalidated");
    await entered;
    valid=false;
    release();
    await rejected;
    expect(await readFile(f.path)).toEqual(before);
    expect(await readdir(f.directory)).toEqual(["credentials.enc"]);
  });
  it("checks the context before decryption and refuses a plaintext result after lock", async () => {
    const f=await fixture();
    await f.vault.save("fixture-original-password", current);
    await expect(f.vault.read(async()=>{throw new Error("fixture context invalidated");})).rejects.toThrow("fixture context invalidated");
    expect(f.codec.decrypt).not.toHaveBeenCalled();
    const decrypt=f.codec.decrypt.getMockImplementation()!;
    let valid=true;
    f.codec.decrypt.mockImplementationOnce(async bytes=>{const value=await decrypt(bytes);valid=false;return value;});
    await expect(f.vault.read(async()=>{if(!valid)throw new Error("fixture context invalidated");})).rejects.toThrow("fixture context invalidated");
  });
  it.each(["damaged ciphertext", "oversize"])("does not treat %s as a missing vault or overwrite it", async damage => {
    const f=await fixture();
    const bytes=damage === "oversize" ? Buffer.alloc(8193) : Buffer.from("fixture corrupt encrypted bytes");
    await writeFile(f.path, bytes);
    if(damage === "oversize")await expect(f.vault.hasCredentials()).rejects.toThrow("無法確認");
    else expect(await f.vault.hasCredentials()).toBe(true);
    await expect(f.vault.read(current)).rejects.toThrow("無法確認");
    expect(await readFile(f.path)).toEqual(bytes);
    expect(f.codec.encrypt).not.toHaveBeenCalled();
  });
  it("rejects decrypted extra fields and never returns server tokens from the vault", async () => {
    const f=await fixture();
    await f.vault.save("fixture-original-password", current);
    f.codec.decrypt.mockResolvedValueOnce(JSON.stringify({version:1,password:"fixture-original-password",token:"fixture-forbidden-token"}));
    await expect(f.vault.read(current)).rejects.toThrow("無法確認");
  });

});
