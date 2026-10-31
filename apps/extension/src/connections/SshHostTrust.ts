import { createHash } from "node:crypto";

import type { SshConfiguration } from "@datsumi/core";

export interface HostKeyState {
  keys?(): readonly string[];
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}
export class SshHostTrust {
  private readonly pending = new Map<string, Promise<boolean>>();
  constructor(
    private readonly state: HostKeyState,
    private readonly confirm: (settings: SshConfiguration, fingerprint: string) => Promise<boolean>,
  ) {}
  private key(settings: SshConfiguration): string {
    return `datsumi.sshHost.${createHash("sha256")
      .update(JSON.stringify([settings.host.toLowerCase(), settings.port]))
      .digest("hex")}`;
  }
  async verify(settings: SshConfiguration, fingerprint: string): Promise<boolean> {
    const key = this.key(settings),
      existing = this.pending.get(key);
    if (existing) {
      await existing.catch(() => false);
      return this.verify(settings, fingerprint);
    }
    const check = this.check(settings, fingerprint);
    this.pending.set(key, check);
    try {
      return await check;
    } finally {
      if (this.pending.get(key) === check) this.pending.delete(key);
    }
  }
  private async check(settings: SshConfiguration, fingerprint: string): Promise<boolean> {
    const key = this.key(settings),
      record = this.state.get<unknown>(key, undefined);
    const saved =
      typeof record === "string"
        ? record
        : record &&
            typeof record === "object" &&
            "fingerprint" in record &&
            typeof record.fingerprint === "string"
          ? record.fingerprint
          : undefined;
    if (saved) {
      if (saved !== fingerprint)
        throw new Error(
          "SSH host key changed. Verify it with the server administrator, then use Forget SSH Host Key before reconnecting.",
        );
      return true;
    }
    if (!(await this.confirm(settings, fingerprint))) return false;
    await this.state.update(key, { host: settings.host, port: settings.port, fingerprint });
    return true;
  }
  list(): (SshConfiguration & { fingerprint: string })[] {
    return (this.state.keys?.() ?? [])
      .filter((key) => key.startsWith("datsumi.sshHost."))
      .flatMap((key) => {
        const record = this.state.get<unknown>(key, undefined);
        if (
          !record ||
          typeof record !== "object" ||
          !("host" in record) ||
          typeof record.host !== "string" ||
          !("port" in record) ||
          typeof record.port !== "number" ||
          !("fingerprint" in record) ||
          typeof record.fingerprint !== "string"
        )
          return [];
        return [
          {
            host: record.host,
            port: record.port,
            fingerprint: record.fingerprint,
            username: "",
            keyPath: "",
          },
        ];
      });
  }
  async forget(settings: SshConfiguration): Promise<void> {
    await this.state.update(this.key(settings), undefined);
  }
}
