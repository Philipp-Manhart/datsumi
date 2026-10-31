/* oxlint-disable no-await-in-loop -- Verify every native file before allowing the worker to load it. */
import { createHash, randomUUID } from "node:crypto";
import { readFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import { familySync, GLIBC, MUSL } from "detect-libc";

import catalog from "../../../../packages/drivers/duckdb/native-catalog.json";

type NativeArtifact = (typeof catalog)[number];
export function duckDbPlatform(
  platform = process.platform,
  arch = process.arch,
  musl?: boolean,
): string {
  let isMusl = musl ?? false;
  if (platform === "linux" && musl === undefined) {
    // Electron extension hosts can return undefined from process.report.getReport().
    // Detect libc from the executable/filesystem instead of assuming a report header.
    let family: string | null;
    try {
      family = familySync();
    } catch {
      family = null;
    }
    if (family !== GLIBC && family !== MUSL)
      throw new Error(
        "Could not detect the Linux C library required by DuckDB. Check that /proc/self/exe or ldd is available on the extension host.",
      );
    isMusl = family === MUSL;
  }
  return `${platform}-${arch}${platform === "linux" && isMusl ? "-musl" : ""}`;
}
export function nativeArtifact(platform = duckDbPlatform()): NativeArtifact {
  const artifact = catalog.find((item) => item.platform === platform);
  if (!artifact)
    throw new Error(
      `DuckDB is unavailable for ${platform}. Supported: Linux, macOS and Windows on x64/arm64.`,
    );
  return artifact;
}
function verifyFile(file: NativeArtifact["files"][number], bytes: Uint8Array): void {
  if (
    bytes.byteLength !== file.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== file.sha256
  )
    throw new Error("DuckDB native file integrity check failed. Reinstall DuckDB support.");
}
/** Only explicitly pinned regular files are extracted; archive paths never become output paths. */
export function extractNativeArchive(
  artifact: NativeArtifact,
  archive: Uint8Array,
): Map<string, Buffer> {
  if (
    archive.byteLength !== artifact.bytes ||
    `sha512-${createHash("sha512").update(archive).digest("base64")}` !== artifact.integrity
  )
    throw new Error("DuckDB download integrity check failed.");
  const tar = gunzipSync(archive, { maxOutputLength: 256 * 1024 * 1024 });
  const files = new Map<string, Buffer>();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").split("\0")[0];
    const sizeText = header.subarray(124, 136).toString("ascii").replaceAll("\0", "").trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("Invalid DuckDB archive header.");
    const size = Number.parseInt(sizeText, 8);
    const start = offset + 512,
      end = start + size;
    if (!Number.isSafeInteger(end) || end > tar.length)
      throw new Error("Incomplete DuckDB archive.");
    const expected = artifact.files.find((file) => name === `package/${file.name}`);
    if (expected) {
      if (
        (header[156] !== 0 && header[156] !== 48) ||
        files.has(expected.name) ||
        header.subarray(345, 500).some((byte) => byte !== 0)
      )
        throw new Error("Invalid DuckDB native archive entry.");
      const bytes = tar.subarray(start, end);
      verifyFile(expected, bytes);
      files.set(expected.name, bytes);
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  if (files.size !== artifact.files.length)
    throw new Error("DuckDB archive is missing required files.");
  return files;
}
export class DuckDbNativeInstaller {
  private pending: Promise<void> | undefined;
  constructor(private readonly directory: string) {}
  async installed(): Promise<boolean> {
    const artifact = nativeArtifact();
    for (const file of artifact.files) {
      try {
        verifyFile(file, await readFile(join(this.directory, file.name)));
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
          return false;
        throw error;
      }
    }
    return true;
  }
  async ensure(signal?: AbortSignal, force = false): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.install(signal, force);
    try {
      await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  private async install(signal?: AbortSignal, force = false): Promise<void> {
    if (!force && (await this.installed())) return;
    const artifact = nativeArtifact();
    // URL and hashes are pinned in the shipped catalog, never supplied by the workspace.
    const response = await fetch(artifact.url, {
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok || !response.body)
      throw new Error(
        "Could not download DuckDB. Check your network and retry; npm is not required.",
      );
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > artifact.bytes) throw new Error("DuckDB download exceeds its expected size.");
      chunks.push(chunk);
    }
    const files = extractNativeArchive(artifact, Buffer.concat(chunks));
    signal?.throwIfAborted();
    const staging = `${this.directory}-${randomUUID()}.tmp`;
    await mkdir(staging, { recursive: true, mode: 0o700 });
    try {
      for (const [name, value] of files)
        await writeFile(join(staging, name), value, { flag: "wx", mode: 0o600 });
      await rm(this.directory, { recursive: true, force: true });
      await rename(staging, this.directory);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
