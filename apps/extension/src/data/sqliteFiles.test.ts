import { mkdtemp, rm, stat, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { expect, it } from "vitest";

import { createSqlite, backupSqlite } from "./sqliteFiles";
it("creates exclusively and backs up committed WAL contents while the source is open", async () => {
  const directory = await mkdtemp(join(tmpdir(), "datsumi-backup-"));
  const source = join(directory, "source.sqlite"),
    target = join(directory, "backup.sqlite");
  try {
    await createSqlite(source);
    await expect(createSqlite(source)).rejects.toThrow(/EEXIST/);
    const db = new DatabaseSync(source);
    try {
      db.exec(
        "PRAGMA journal_mode=WAL; CREATE TABLE data(id INTEGER PRIMARY KEY,note TEXT); INSERT INTO data VALUES(1,'in WAL')",
      );
      await backupSqlite(source, target);
      const copied = new DatabaseSync(target, { readOnly: true });
      try {
        expect(copied.prepare("SELECT note FROM data").get()?.note).toBe("in WAL");
      } finally {
        copied.close();
      }
      const alias = join(directory, "alias.sqlite");
      await link(source, alias);
      await expect(backupSqlite(source, alias)).rejects.toThrow(/different from|link/);
      expect(db.prepare("SELECT COUNT(*) AS n FROM data").get()?.n).toBe(1);
      // oxlint-disable-next-line vitest/no-conditional-expect -- Windows ACLs do not expose POSIX permission bits.
      if (process.platform !== "win32") expect((await stat(target)).mode & 0o077).toBe(0);
    } finally {
      db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
