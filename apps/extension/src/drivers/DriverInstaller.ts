import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { isNoSqlDriver, type NoSqlDriver } from "@datsumi/driver-nosql/configuration";
import { isServerDriver, type ServerDriver } from "@datsumi/driver-sql/configuration";
type DriverId = ServerDriver | NoSqlDriver | "duckdb";
export interface DriverArtifact {
  id: DriverId;
  file: string;
  sha256: string;
  bytes: number;
  nodeMajor: number;
}
export function parseCatalog(value: unknown): DriverArtifact[] {
  if (!Array.isArray(value)) throw new Error("Driver catalog is invalid.");
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== "object") throw new Error("Driver catalog is invalid.");
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Every catalog field is validated below before it can influence a path or download.
    const item = entry as Record<string, unknown>;
    if (
      (!isServerDriver(item.id) && !isNoSqlDriver(item.id) && item.id !== "duckdb") ||
      item.file !== `${item.id}.cjs` ||
      typeof item.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(item.sha256) ||
      typeof item.bytes !== "number" ||
      !Number.isSafeInteger(item.bytes) ||
      item.bytes < 1 ||
      item.bytes > 64 * 1024 * 1024 ||
      typeof item.nodeMajor !== "number" ||
      item.nodeMajor < 20
    )
      throw new Error("Driver catalog is invalid.");
    return {
      id: item.id,
      file: item.file,
      sha256: item.sha256,
      bytes: item.bytes,
      nodeMajor: item.nodeMajor,
    };
  });
}
/** Catalog is shipped inside this extension, never accepted from a download server. */
export class DriverInstaller {
  constructor(
    private readonly root: string,
    private readonly catalog: readonly DriverArtifact[],
  ) {}
  private artifact(id: DriverId): DriverArtifact {
    const artifact = this.catalog.find((item) => item.id === id);
    if (!artifact) throw new Error("Database driver is not available in this release.");
    if (Number(process.versions.node.split(".")[0]) < artifact.nodeMajor)
      throw new Error("Update VS Code: this driver needs a newer extension-host Node runtime.");
    return artifact;
  }
  private path(item: DriverArtifact): string {
    return join(this.root, item.sha256, item.file);
  }
  private verify(item: DriverArtifact, bytes: Uint8Array): void {
    if (
      bytes.byteLength !== item.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== item.sha256
    )
      throw new Error(
        "Driver integrity check failed. Select the matching artifact from this extension release.",
      );
  }
  async installed(id: DriverId): Promise<string | undefined> {
    const item = this.artifact(id),
      path = this.path(item);
    try {
      this.verify(item, await readFile(path));
      return path;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return undefined;
      throw error;
    }
  }
  async ensure(
    id: DriverId,
    options: {
      bundledDirectory: string;
      downloadBaseUrl?: string;
      signal?: AbortSignal;
      force?: boolean;
    },
  ): Promise<string> {
    const existing = options.force ? undefined : await this.installed(id);
    if (existing) return existing;
    if (options.downloadBaseUrl) return this.download(id, options.downloadBaseUrl, options.signal);
    return this.installFile(id, join(options.bundledDirectory, this.artifact(id).file));
  }
  async installFile(id: DriverId, path: string): Promise<string> {
    return this.install(id, await readFile(path));
  }
  private async install(id: DriverId, bytes: Uint8Array): Promise<string> {
    const item = this.artifact(id);
    this.verify(item, bytes);
    const directory = join(this.root, item.sha256),
      path = this.path(item),
      temporary = join(directory, `${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
    return path;
  }
  async download(id: DriverId, base: string, signal?: AbortSignal): Promise<string> {
    const item = this.artifact(id),
      url = new URL(item.file, base.endsWith("/") ? base : base + "/");
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Driver downloads require an HTTPS URL without credentials.");
    const response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.any([AbortSignal.timeout(120000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok || !response.body) throw new Error("Database driver download failed.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > item.bytes) {
        await response.body.cancel().catch(() => {});
        throw new Error("Driver download exceeds the expected size.");
      }
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    return this.install(id, bytes);
  }
  async remove(id: DriverId): Promise<void> {
    const item = this.artifact(id);
    await rm(this.path(item), { force: true });
  }
}
