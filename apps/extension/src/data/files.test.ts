import { mkdtemp, writeFile, readFile, rm, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

const choice = vi.hoisted(() => ({ path: "" }));
vi.mock("vscode", () => ({
  window: { showSaveDialog: async () => ({ fsPath: choice.path, scheme: "file" }) },
  env: { remoteName: undefined },
  workspace: { getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }) },
}));
import { saveEditDraft } from "./editDraft";
import { saveResult } from "./files";

it("captured-result and draft saves reject protected destinations before replacing files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "datsumi-export-guard-"));
  try {
    choice.path = join(directory, "database.csv");
    await writeFile(choice.path, "database fixture");
    const guard = vi.fn<(path: string) => Promise<void>>(async (_path) => {
      throw new Error("Protected database");
    });
    await expect(
      saveResult({ kind: "table", columns: ["id"], rows: [[1]] }, "csv", "fixture", guard),
    ).rejects.toThrow("Protected database");
    await expect(
      saveEditDraft("connection", "table", [{ kind: "insert", values: { id: 1 } }], guard),
    ).rejects.toThrow("Protected database");
    expect(await readFile(choice.path, "utf8")).toBe("database fixture");
    const original = choice.path;
    choice.path = join(directory, "alias.csv");
    await link(original, choice.path);
    await expect(
      saveResult({ kind: "table", columns: ["id"], rows: [[1]] }, "csv", "fixture", async () => {}),
    ).rejects.toThrow("link");
    expect(await readFile(original, "utf8")).toBe("database fixture");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
