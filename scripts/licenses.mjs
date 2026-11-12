/* oxlint-disable no-await-in-loop -- Inspect every shipped component and its required notices before packaging. */
import { readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const permissive = new Set([
  "MIT",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "Apache-2.0",
  "CC0-1.0",
  "CC-BY-4.0",
  "(Apache-2.0 OR UPL-1.0)",
  "(MIT OR Apache-2.0)",
  "(MIT AND Zlib)",
  "Zlib",
  "Python-2.0",
  "BlueOak-1.0.0",
  "Unlicense",
]);
async function component(path) {
  let directory = dirname(await realpath(path));
  for (;;) {
    try {
      const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
      if (pkg.name && directory.replaceAll("\\", "/").endsWith("/node_modules/" + pkg.name))
        return { directory, pkg };
    } catch {}
    const parent = dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}
export async function collectLicenses(inputs, base = root) {
  const found = new Map();
  for (const input of inputs) {
    if (input.startsWith("\0") || !input.includes("node_modules")) continue;
    const path = resolve(base, input.split("?")[0]);
    if (!(await stat(path).catch(() => undefined))?.isFile()) continue;
    const item = await component(path);
    if (item && !item.pkg.name.startsWith("@datsumi/"))
      found.set(`${item.pkg.name}@${item.pkg.version}`, item);
  }
  const inventory = [],
    notices = [];
  for (const [id, { directory, pkg }] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    const license =
      typeof pkg.license === "string"
        ? pkg.license
        : (pkg.license?.type ?? (pkg.licenses?.length === 1 ? pkg.licenses[0].type : undefined));
    if (!permissive.has(license))
      throw new Error(`License review required for shipped component ${id}: ${license}`);
    const texts = [];
    for (const name of (await readdir(directory)).sort()) {
      if (!/^(?:licen[sc]e|notice|copying|copyright|third.party.licenses)(?:[. _-]|$)/i.test(name))
        continue;
      const path = join(directory, name);
      if ((await stat(path)).isFile()) texts.push(`${name}\n${await readFile(path, "utf8")}`);
    }
    if (!texts.length) {
      const readme = await readFile(join(directory, "README.md"), "utf8").catch(() => "");
      const notice = readme.match(/(?:^|\n)#{1,3}\s+licen[sc]e[^\n]*\n([\s\S]*)/i)?.[1];
      if (notice && /permission is hereby granted/i.test(notice) && /copyright/i.test(notice))
        texts.push("README license section\n" + notice);
    }
    if (
      !texts.length &&
      pkg.version === "6.3.0" &&
      (pkg.name === "redis" || pkg.name.startsWith("@redis/"))
    )
      texts.push(
        await readFile(
          join(root, "packages/drivers/nosql/notices/node-redis-6.3.0.LICENSE"),
          "utf8",
        ),
      );
    if (!texts.length && pkg.name === "@tursodatabase/serverless" && pkg.version === "1.4.1")
      texts.push(
        await readFile(
          join(root, "packages/drivers/sql/notices/turso-serverless-1.4.1.LICENSE"),
          "utf8",
        ),
      );
    if (
      !texts.length &&
      ["@libsql/client", "@libsql/core"].includes(pkg.name) &&
      pkg.version === "0.18.0"
    )
      texts.push(
        await readFile(
          join(root, "packages/drivers/sql/notices/libsql-client-0.18.0.LICENSE"),
          "utf8",
        ),
      );
    if (!texts.length && pkg.name === "@libsql/isomorphic-ws" && pkg.version === "0.1.5")
      texts.push(
        await readFile(
          join(root, "packages/drivers/sql/notices/libsql-isomorphic-ws-0.1.5.LICENSE"),
          "utf8",
        ),
      );
    if (!texts.length && pkg.name === "promise-limit" && pkg.version === "2.7.0")
      texts.push(
        await readFile(
          join(root, "packages/drivers/sql/notices/promise-limit-2.7.0.LICENSE"),
          "utf8",
        ),
      );
    if (!texts.length) throw new Error(`Missing license text for shipped component ${id}`);
    inventory.push({ name: pkg.name, version: pkg.version, license });
    notices.push(`${id} — ${license}\n${texts.join("\n\n")}`);
  }
  return { inventory, text: notices.join("\n\n---\n\n") + "\n" };
}
export async function writeLicenses(inputs, output, base = root) {
  const result = await collectLicenses(inputs, base);
  await writeFile(`${output}.NOTICES.txt`, result.text);
  await writeFile(`${output}.components.json`, JSON.stringify(result.inventory, null, 2) + "\n");
  return result;
}
