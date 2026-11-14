import { open, stat, rm } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

import { atomicOutput, type OutputValidator } from "./outputFile";

/** Exclusive creation never replaces an existing database or unrelated file. */
export async function createSqlite(path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error("Choose an absolute SQLite file path.");
  const file = await open(path, "wx", 0o600);
  await file.close();
  try {
    const db = new DatabaseSync(path, { allowExtension: false });
    try {
      db.exec("PRAGMA user_version=0");
    } finally {
      db.close();
    }
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  }
}
/** SQLite's online backup includes WAL contents without copying live database files. */
export async function backupSqlite(
  source: string,
  destination: string,
  validate: OutputValidator = async () => {},
): Promise<void> {
  const original = await stat(source);
  await atomicOutput(
    destination,
    async (path) => {
      const existing = await stat(path).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (existing && original.dev === existing.dev && original.ino === existing.ino)
        throw new Error("Choose a backup destination different from the source database.");
      await validate(path);
    },
    async (temporary) => {
      const db = new DatabaseSync(source, { readOnly: true, allowExtension: false });
      try {
        const file = await open(temporary, "wx", 0o600);
        await file.close();
        await backup(db, temporary);
      } finally {
        db.close();
      }
    },
  );
}
