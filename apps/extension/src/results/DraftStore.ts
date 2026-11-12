import { createHash } from "node:crypto";

import type { ConnectionProfile, RowChange, TableInfo } from "@datsumi/core";
import { rowChangeSchema } from "@datsumi/protocol";
import type { Memento } from "vscode";

interface Draft {
  savedAt: number;
  changes: readonly RowChange[];
}
/** Explicitly opted-in local data. Never a write queue; recovery must be reviewed again. */
export class DraftStore {
  private queue = Promise.resolve();
  constructor(
    private readonly state: Memento,
    private readonly options: () => { enabled: boolean; days: number },
  ) {}
  key(profile: ConnectionProfile, table: TableInfo): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          profile.id,
          profile.driverId,
          profile.configuration,
          profile.ssh,
          table.resourceId,
          table.columns,
        ]),
      )
      .digest("hex");
  }
  private read(): Record<string, Draft> {
    const value = this.state.get<unknown>("datsumi.drafts", {});
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, Draft> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        !/^[a-f0-9]{64}$/.test(key) ||
        !entry ||
        typeof entry !== "object" ||
        !("savedAt" in entry) ||
        typeof entry.savedAt !== "number" ||
        !Number.isFinite(entry.savedAt) ||
        entry.savedAt < Date.now() - this.options().days * 86400000 ||
        !("changes" in entry)
      )
        continue;
      const parsed = rowChangeSchema.array().min(1).max(1000).safeParse(entry.changes);
      if (parsed.success && Buffer.byteLength(JSON.stringify(parsed.data)) <= 1024 * 1024)
        result[key] = { savedAt: entry.savedAt, changes: parsed.data };
    }
    return result;
  }
  load(key: string): Draft | undefined {
    if (!this.options().enabled) return undefined;
    const entries = this.read();
    const stored = this.state.get<unknown>("datsumi.drafts", {});
    if (
      stored &&
      typeof stored === "object" &&
      Object.keys(stored).length !== Object.keys(entries).length
    )
      this.queue = this.queue
        .catch(() => {})
        .then(() => this.state.update("datsumi.drafts", this.read()));
    return entries[key];
  }
  save(key: string, changes: readonly RowChange[]): Promise<void> {
    if (!this.options().enabled) return this.clear();
    this.queue = this.queue
      .catch(() => {})
      .then(async () => {
        const entries = this.options().enabled ? this.read() : {};
        delete entries[key];
        if (this.options().enabled && changes.length) {
          if (Buffer.byteLength(JSON.stringify(changes)) > 1024 * 1024)
            throw new Error(
              "Draft recovery is limited to 1 MiB per table. Save the draft to a file instead.",
            );
          entries[key] = {
            savedAt: Date.now(),
            changes: rowChangeSchema.array().max(1000).parse(changes),
          };
        }
        await this.state.update(
          "datsumi.drafts",
          Object.fromEntries(
            Object.entries(entries)
              .sort((a, b) => b[1].savedAt - a[1].savedAt)
              .slice(0, 10),
          ),
        );
      });
    return this.queue;
  }
  async clear(): Promise<void> {
    await this.queue.catch(() => {});
    const saved = this.state.get<unknown>("datsumi.drafts", {});
    if (saved && (typeof saved !== "object" || Object.keys(saved).length))
      await this.state.update("datsumi.drafts", {});
  }
}
