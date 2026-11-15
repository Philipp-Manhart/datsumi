import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { duckDbPlatform, nativeArtifact, extractNativeArchive } from "./DuckDbNativeInstaller";
function fixture(
  options: { name?: string; type?: string; duplicate?: boolean; missing?: boolean } = {},
) {
  const value = Buffer.from("native fixture");
  const header = Buffer.alloc(512);
  header.write(options.name ?? "package/duckdb.node");
  header.write(value.length.toString(8).padStart(11, "0") + "\0", 124);
  header.write(options.type ?? "0", 156);
  const entry = Buffer.concat([header, value, Buffer.alloc(512 - value.length)]);
  const archive = gzipSync(
    Buffer.concat([
      ...(options.missing ? [] : [entry]),
      ...(options.duplicate ? [entry] : []),
      Buffer.alloc(1024),
    ]),
  );
  const artifact = {
    platform: "linux-x64",
    url: "https://registry.npmjs.org/fixture.tgz",
    bytes: archive.length,
    integrity: `sha512-${createHash("sha512").update(archive).digest("base64")}`,
    files: [
      {
        name: "duckdb.node",
        bytes: value.length,
        sha256: createHash("sha256").update(value).digest("hex"),
      },
    ],
  };
  return { artifact, archive, value };
}
describe("DuckDB native artifact verification", () => {
  it("selects platform and libc variants, rejecting unsupported hosts", () => {
    expect(duckDbPlatform("linux", "arm64", true)).toBe("linux-arm64-musl");
    expect(duckDbPlatform("linux", "x64", false)).toBe("linux-x64");
    expect(duckDbPlatform("darwin", "arm64", false)).toBe("darwin-arm64");
    expect(nativeArtifact("win32-x64").files.some((file) => file.name === "duckdb.dll")).toBe(true);
    expect(() => nativeArtifact("linux-ia32")).toThrow(/unavailable/);
  });
  it.each([
    "linux-x64",
    "linux-arm64",
    "linux-x64-musl",
    "linux-arm64-musl",
    "darwin-x64",
    "darwin-arm64",
    "win32-x64",
    "win32-arm64",
  ])("has a complete reviewed native payload for %s", (platform) => {
    const item = nativeArtifact(platform);
    expect(item.files.map((file) => file.name)).toContain("duckdb.node");
    expect(item.files.map((file) => file.name)).toContain("LICENSE");
    expect(item.url).toContain("registry.npmjs.org/");
    expect(item.integrity).toMatch(/^sha512-/);
  });
  it("extracts only pinned regular files after verifying the complete archive", () => {
    const { artifact, archive, value } = fixture();
    expect(extractNativeArchive(artifact, archive).get("duckdb.node")).toEqual(value);
    archive[10] = archive[10]! ^ 1;
    expect(() => extractNativeArchive(artifact, archive)).toThrow(/integrity/);
  });
  it("rejects traversal, symbolic links, duplicates, missing files and incorrect file hashes", () => {
    for (const options of [
      { name: "package/../duckdb.node" },
      { type: "2" },
      { duplicate: true },
      { missing: true },
    ]) {
      const { artifact, archive } = fixture(options);
      expect(() => extractNativeArchive(artifact, archive)).toThrow(/DuckDB/);
    }
    const { artifact, archive } = fixture();
    artifact.files[0]!.sha256 = "0".repeat(64);
    expect(() => extractNativeArchive(artifact, archive)).toThrow(/integrity/);
  });
});

it.runIf(process.platform === "linux")(
  "detects Linux libc when Electron returns no diagnostic report",
  () => {
    const descriptor = Object.getOwnPropertyDescriptor(process, "report")!;
    Object.defineProperty(process, "report", {
      configurable: true,
      value: { getReport: () => undefined },
    });
    try {
      expect(duckDbPlatform()).toMatch(/^linux-(?:x64|arm64)(?:-musl)?$/);
    } finally {
      Object.defineProperty(process, "report", descriptor);
    }
  },
);
