import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DriverInstaller, parseCatalog, type DriverArtifact } from "./DriverInstaller";
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "datsumi-driver-"));
  roots.push(root);
  const bytes = Buffer.from("// trusted fixture driver\n"),
    item: DriverArtifact = {
      id: "postgres",
      file: "postgres.cjs",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      bytes: bytes.length,
      nodeMajor: 22,
    };
  const source = join(root, "source.cjs");
  await writeFile(source, bytes);
  return { root, bytes, item, source, installer: new DriverInstaller(join(root, "cache"), [item]) };
}
describe("optional driver installation", () => {
  it("installs offline, validates every load, rejects tampering, and removes support", async () => {
    const { installer, source } = await fixture();
    expect(await installer.installed("postgres")).toBeUndefined();
    const path = await installer.installFile("postgres", source);
    expect(await installer.installed("postgres")).toBe(path);
    await writeFile(path, "modified");
    await expect(installer.installed("postgres")).rejects.toThrow("integrity");
    await installer.installFile("postgres", source);
    await installer.remove("postgres");
    expect(await installer.installed("postgres")).toBeUndefined();
  });
  it("automatically installs bundled support offline and reuses the verified cache", async () => {
    const { installer, root, source, bytes } = await fixture();
    await writeFile(join(root, "postgres.cjs"), bytes);
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const options = { bundledDirectory: root };
    const path = await installer.ensure("postgres", options);
    expect(await readFile(path)).toEqual(bytes);
    await rm(join(root, "postgres.cjs"));
    expect(await installer.ensure("postgres", options)).toBe(path);
    expect(fetch).not.toHaveBeenCalled();
    await writeFile(path, "tampered");
    await expect(installer.ensure("postgres", options)).rejects.toThrow("integrity");
    await writeFile(join(root, "postgres.cjs"), await readFile(source));
    expect(await installer.ensure("postgres", { ...options, force: true })).toBe(path);
    expect(await installer.installed("postgres")).toBe(path);
  });
  it("automatically uses configured HTTPS hosting and fails closed on download failure", async () => {
    const { installer, root, bytes } = await fixture();
    const options = { bundledDirectory: root, downloadBaseUrl: "https://example.com/release/" };
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(bytes));
    vi.stubGlobal("fetch", fetch);
    await installer.ensure("postgres", options);
    expect(fetch).toHaveBeenCalledWith(new URL("https://example.com/release/postgres.cjs"), {
      redirect: "error",
    });
    await installer.remove("postgres");
    await writeFile(join(root, "postgres.cjs"), bytes);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("modified")),
    );
    await expect(installer.ensure("postgres", options)).rejects.toThrow("integrity");
    expect(await installer.installed("postgres")).toBeUndefined();
  });
  it("rejects incompatible or malicious catalogs", () => {
    expect(() => parseCatalog([{ id: "postgres", file: "../worker.cjs" }])).toThrow("invalid");
    expect(() => parseCatalog([null])).toThrow("invalid");
  });
  it("verifies downloaded bytes and never accepts replacement hashes from the server", async () => {
    const { installer, bytes } = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(bytes)),
    );
    const path = await installer.download("postgres", "https://example.com/release/");
    expect(await readFile(path)).toEqual(bytes);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad")),
    );
    await expect(installer.download("postgres", "https://example.com/release/")).rejects.toThrow(
      "integrity",
    );
    expect(await installer.installed("postgres")).toBe(path);
  });
  it("rejects plaintext transport, credential-bearing URLs and unsuccessful responses", async () => {
    const { installer } = await fixture();
    await expect(installer.download("postgres", "http://example.com/")).rejects.toThrow("HTTPS");
    await expect(
      installer.download("postgres", "https://user:password@example.com/"),
    ).rejects.toThrow("HTTPS");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await expect(installer.download("postgres", "https://example.com/")).rejects.toThrow(
      "download failed",
    );
  });
});
