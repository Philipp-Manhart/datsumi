import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const root = resolve(import.meta.dirname, "..");
const directories = (await readdir(join(root, "test-results/release")).catch(() => []))
  .sort((a, b) => a.localeCompare(b))
  .reverse();
let report;
for (const directory of directories) {
  try {
    report = JSON.parse(
      await readFile(join(root, "test-results/release", directory, "report.json"), "utf8"),
    );
    break;
  } catch {
    /* Incomplete runs have no report yet. */
  }
}
if (!report) throw new Error("Run bun run release:check from a clean commit first.");
const approval = await readFile(join(root, "publication-approval.json"), "utf8")
  .then(JSON.parse)
  .catch(() => ({}));
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const checks = {
  localChecksPassed: report.localChecksPassed === true,
  commitMatches: report.commit === head,
  artifactMatches: false,
  publicDocumentation: false,
  privateSecurityReporting: false,
  publisherOwnership: approval.checks?.publisherOwnership === true,
  listingReviewed: approval.checks?.listingReviewed === true,
  maintainerApproval: false,
};
if (report.artifact)
  checks.artifactMatches =
    createHash("sha256")
      .update(await readFile(join(root, report.artifact.file)))
      .digest("hex") === report.artifact.sha256;
checks.maintainerApproval =
  approval.approvedCommit === head &&
  approval.artifactSha256 === report.artifact?.sha256 &&
  typeof approval.reviewedBy === "string" &&
  Boolean(approval.reviewedBy.trim()) &&
  approval.approved === true;
if (!process.argv.includes("--offline")) {
  const pages = ["README.md", "LICENSE", "PRIVACY.md", "SECURITY.md", "SUPPORT.md"].map(
    (name) => `https://raw.githubusercontent.com/Philipp-Manhart/datsumi/${head}/${name}`,
  );
  const responses = await Promise.allSettled(
    pages.map((url) =>
      fetch(url, { redirect: "error", signal: AbortSignal.timeout(15000) }).then((r) => r.ok),
    ),
  );
  checks.publicDocumentation = responses.every(
    (result) => result.status === "fulfilled" && result.value,
  );
  try {
    const response = await fetch(
      "https://api.github.com/repos/Philipp-Manhart/datsumi/private-vulnerability-reporting",
      { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15000) },
    );
    checks.privateSecurityReporting = response.ok && (await response.json()).enabled === true;
  } catch {
    /* Remains explicitly pending, never an automatic approval. */
  }
}
const result = {
  commit: head,
  artifact: report.artifact,
  publicationApproved: Object.values(checks).every(Boolean),
  checks,
  note: "This command reports readiness only. It never publishes, changes visibility, or creates credentials.",
};
await mkdir(join(root, "test-results"), { recursive: true });
await writeFile(
  join(root, "test-results/publication.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
if (!result.publicationApproved) process.exitCode = 1;
