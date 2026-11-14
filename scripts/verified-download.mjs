import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
export async function verifiedDownload({
  url,
  sha256,
  maxBytes,
  timeoutMs = 120000,
  directory = join(homedir(), ".cache", "datsumi", "verified-artifacts"),
}) {
  if (
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 1 ||
    maxBytes > 512 * 1024 * 1024 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 600000
  )
    throw new Error("Invalid pinned artifact metadata.");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    (process.getuid && info.uid !== process.getuid()) ||
    (process.platform !== "win32" && info.mode & 0o077)
  )
    throw new Error("Artifact cache must be a private user-owned directory (mode 0700).");
  const path = join(directory, sha256);
  const verify = (bytes) => {
    if (bytes.length > maxBytes || createHash("sha256").update(bytes).digest("hex") !== sha256)
      throw new Error(
        "Cached/downloaded artifact checksum mismatch; remove the corrupt cache entry and retry.",
      );
    return bytes;
  };
  const cached = await lstat(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (cached) {
    if (
      !cached.isFile() ||
      cached.isSymbolicLink() ||
      (process.getuid && cached.uid !== process.getuid())
    )
      throw new Error("Unsafe artifact cache entry.");
    if (cached.size > maxBytes) throw new Error("Cached artifact exceeds the size limit.");
    return verify(await readFile(path));
  }
  const source = new URL(url);
  if (source.protocol !== "https:" || source.username || source.password)
    throw new Error("Verified downloads require HTTPS without credentials.");
  const signal = AbortSignal.timeout(timeoutMs);
  let current = new URL(url);
  let response;
  for (let redirects = 0; ; redirects++) {
    response = await fetch(current, { redirect: "manual", signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (redirects >= 2 || !location) throw new Error("Artifact redirect rejected.");
    const next = new URL(location, current);
    if (
      new URL(url).hostname !== "github.com" ||
      next.protocol !== "https:" ||
      next.username ||
      next.password ||
      !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(
        next.hostname,
      )
    )
      throw new Error("Artifact redirect rejected.");
    await response.body?.cancel();
    current = next;
  }
  if (!response.ok || !response.body) throw new Error("Artifact download failed.");
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.length;
    if (total > maxBytes) throw new Error("Artifact exceeds the download limit.");
    chunks.push(chunk);
  }
  const bytes = verify(Buffer.concat(chunks));
  const temporary = path + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return bytes;
}
