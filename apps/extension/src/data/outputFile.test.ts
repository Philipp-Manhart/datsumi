import { mkdtemp, rm, writeFile, readFile, link, symlink, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { atomicOutput, writeOutput } from "./outputFile";

it("never follows output aliases, including CSV aliases of database files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "datsumi-output-"));
  try {
    const database = join(directory, "private.sqlite");
    await writeFile(database, "original database");
    for (const kind of ["hard", "symbolic"]) {
      const alias = join(directory, `${kind}.csv`);
      if (kind === "hard") await link(database, alias);
      else await symlink(database, alias);
      await expect(writeOutput(alias, "export", async () => {})).rejects.toThrow("link");
      expect(await readFile(database, "utf8")).toBe("original database");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves existing files after producer failures, cancellation and destination validation failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "datsumi-output-"));
  const path = join(directory, "export.csv");
  try {
    await writeFile(path, "previous export");
    await expect(
      atomicOutput(
        path,
        async () => {},
        async (temporary) => {
          await writeFile(temporary, "partial");
          throw new Error("ENOSPC fixture");
        },
      ),
    ).rejects.toThrow("ENOSPC");
    const abort = new AbortController();
    await expect(
      atomicOutput(
        path,
        async () => {},
        async (temporary) => {
          await writeFile(temporary, "cancelled");
          abort.abort();
        },
        abort.signal,
      ),
    ).rejects.toThrow(/abort/i);
    let checks = 0;
    await expect(
      writeOutput(path, "unsafe", async () => {
        if (++checks === 2) throw new Error("Destination became a database");
      }),
    ).rejects.toThrow("database");
    expect(await readFile(path, "utf8")).toBe("previous export");
    expect(await readdir(directory)).toEqual(["export.csv"]);
    await writeOutput(path, "complete", async () => {});
    expect(await readFile(path, "utf8")).toBe("complete");
    // oxlint-disable-next-line vitest/no-conditional-expect -- POSIX permissions have no Windows ACL equivalent.
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o077).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
