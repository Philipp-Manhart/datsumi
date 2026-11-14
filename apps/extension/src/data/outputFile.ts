import { randomUUID } from "node:crypto";
import { lstat, open, rename, rm } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type OutputValidator = (path: string) => Promise<void>;

/** Publish a complete private file without following a destination alias or truncating it. */
export async function atomicOutput<T>(
  path: string,
  validate: OutputValidator,
  produce: (temporary: string) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!isAbsolute(path)) throw new Error("Choose an absolute output file path.");
  async function check() {
    signal?.throwIfAborted();
    const existing = await lstat(path).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (existing && (!existing.isFile() || existing.nlink > 1))
      throw new Error("Choose a regular output file that is not a symbolic or hard link.");
    await validate(path);
  }
  await check();
  const temporary = `${path}.datsumi-${randomUUID()}.tmp`;
  try {
    const result = await produce(temporary);
    const file = await open(temporary, "r+");
    try {
      await file.chmod(0o600);
      await file.sync();
    } finally {
      await file.close();
    }
    await check();
    await rename(temporary, path);
    return result;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function writeOutput(
  path: string,
  contents: string,
  validate: OutputValidator,
  signal?: AbortSignal,
): Promise<void> {
  await atomicOutput(
    path,
    validate,
    async (temporary) => {
      const file = await open(temporary, "wx", 0o600);
      try {
        signal?.throwIfAborted();
        await file.writeFile(contents, "utf8");
      } finally {
        await file.close();
      }
    },
    signal,
  );
}
