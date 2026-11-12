import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

// @ts-expect-error Build-only JavaScript license collector.
import { collectLicenses } from "../../../../scripts/licenses.mjs";
// @ts-expect-error Build/maintenance-only JavaScript helpers.
import { verifiedDownload } from "../../../../scripts/verified-download.mjs";
it("never executes or trusts tampered/symlinked cached artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "datsumi-cache-test-"));
  const bytes = Buffer.from("verified archive"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  try {
    await writeFile(join(directory, sha256), "tampered", { mode: 0o600 });
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    await expect(
      verifiedDownload({ url: "https://example.com/archive", sha256, maxBytes: 100, directory }),
    ).rejects.toThrow("checksum");
    expect(fetch).not.toHaveBeenCalled();
    await rm(join(directory, sha256));
    const other = join(directory, "other");
    await writeFile(other, bytes);
    await symlink(other, join(directory, sha256));
    await expect(
      verifiedDownload({ url: "https://example.com/archive", sha256, maxBytes: 100, directory }),
    ).rejects.toThrow("Unsafe");
  } finally {
    vi.unstubAllGlobals();
    await rm(directory, { recursive: true, force: true });
  }
});
it("requires reviewed licenses and full notices for every bundled component", async () => {
  const directory = await mkdtemp(join(tmpdir(), "datsumi-license-test-"));
  const pkg = join(directory, "node_modules", "example");
  await mkdir(pkg, { recursive: true });
  const input = join(pkg, "index.js");
  await writeFile(input, "export default 1");
  try {
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "example", version: "1.0.0", license: "MIT" }),
    );
    await expect(collectLicenses([input])).rejects.toThrow("Missing license text");
    await writeFile(join(pkg, "LICENSE"), "MIT notice fixture");
    expect((await collectLicenses([input])).inventory).toEqual([
      { name: "example", version: "1.0.0", license: "MIT" },
    ]);
    await writeFile(
      join(pkg, "package.json"),
      JSON.stringify({ name: "example", version: "1.0.0", license: "LGPL-2.1-only" }),
    );
    await expect(collectLicenses([input])).rejects.toThrow("License review required");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
