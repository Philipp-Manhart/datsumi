import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const base = [
  "compose",
  "-p",
  `datsumi-nosql-${randomUUID().slice(0, 8)}`,
  "-f",
  "packages/drivers/nosql/test/compose.yml",
];
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
  return result;
}
try {
  run("node", ["packages/drivers/sql/build.mjs"]);
  run("docker", [...base, "up", "-d", "--wait", "--wait-timeout", "120"]);
  const env = { ...process.env };
  for (const [id, port] of [
    ["mongodb", 27017],
    ["redis", 6379],
  ]) {
    const result = run("docker", [...base, "port", id, String(port)], {
      encoding: "utf8",
      stdio: "pipe",
    });
    env[`DATSUMI_TEST_${id.toUpperCase()}_PORT`] = result.stdout.trim().split(":").at(-1);
  }
  run("bunx", ["vitest", "run", "--config", "packages/drivers/nosql/test/vitest.config.ts"], {
    env,
  });
  if (process.env.DATSUMI_TEST_NATIVE === "1")
    run("bun", ["run", "test:integration"], { env: { ...env, DATSUMI_TEST_HEADLESS: "1" } });
} finally {
  run("docker", [...base, "down", "--volumes", "--remove-orphans"]);
}
