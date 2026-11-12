import { randomUUID } from "node:crypto";
import { open, stat, rename, rm, chmod } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";

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
export async function backupSqlite(source: string, destination: string): Promise<void> {
  const original = await stat(source);
  const existing = await stat(destination).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (existing && original.dev === existing.dev && original.ino === existing.ino)
    throw new Error("Choose a backup destination different from the source database.");
  const temporary = `${destination}.datsumi-${randomUUID()}.tmp`;
  const db = new DatabaseSync(source, { readOnly: true, allowExtension: false });
  try {
    const file = await open(temporary, "wx", 0o600);
    await file.close();
    await backup(db, temporary);
    await chmod(temporary, existing ? existing.mode & 0o777 : 0o600);
    await rename(temporary, destination);
  } finally {
    db.close();
    await rm(temporary, { force: true });
  }
}
