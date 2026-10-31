import { createHash } from "node:crypto";

import type { ConnectionProfile } from "@datsumi/core";
type CredentialMode = "ask" | "session" | "save";
export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}
export interface CredentialAnswer {
  password: string;
  mode: CredentialMode;
}
export type CredentialPrompt = (
  profile: ConnectionProfile,
) => Promise<CredentialAnswer | undefined>;
export class CredentialService {
  private readonly revoked = new Set<string>();
  private readonly sessions = new Map<string, { binding: string; password: string }>();
  constructor(
    private readonly secrets: SecretStore,
    private readonly prompt: CredentialPrompt,
    private readonly environment: string,
  ) {}
  private key(id: string): string {
    if (!/^[\da-f-]{36}$/i.test(id)) throw new Error("Invalid credential identity.");
    return `datsumi.credential.v1.${id}`;
  }
  private binding(profile: ConnectionProfile): string {
    return createHash("sha256")
      .update(
        JSON.stringify([
          this.environment,
          profile.driverId,
          Object.entries(profile.configuration).sort(([a], [b]) => a.localeCompare(b)),
          ...(profile.ssh ? [profile.ssh] : []),
        ]),
      )
      .digest("hex");
  }
  async set(
    profile: ConnectionProfile,
    answer: CredentialAnswer,
    freshIdentity = false,
  ): Promise<void> {
    if (answer.password.length > 65536) throw new Error("Password is too long.");
    const key = this.key(profile.id),
      binding = this.binding(profile);
    this.sessions.delete(profile.id);
    this.revoked.add(profile.id);
    try {
      if (answer.mode === "save")
        await this.secrets.store(
          key,
          JSON.stringify({ version: 1, binding, password: answer.password }),
        );
      else if (!freshIdentity) await this.secrets.delete(key);
    } catch {
      throw new Error(
        "Secure credential storage is unavailable. Retry with session-only credentials after fixing the credential store.",
      );
    }
    if (answer.mode === "save") this.revoked.delete(profile.id);
    if (answer.mode === "session")
      this.sessions.set(profile.id, { binding, password: answer.password });
  }
  async resolve(profile: ConnectionProfile): Promise<string> {
    const binding = this.binding(profile);
    const session = this.sessions.get(profile.id);
    if (session) {
      if (session.binding !== binding)
        throw new Error(
          "Connection destination changed. Enter credentials again before connecting.",
        );
      return session.password;
    }
    let saved: string | undefined;
    try {
      saved = this.revoked.has(profile.id)
        ? undefined
        : await this.secrets.get(this.key(profile.id));
      // Forget may complete while an earlier keychain read is still pending.
      if (this.revoked.has(profile.id)) saved = undefined;
    } catch {
      throw new Error(
        "Secure credential storage could not be read. Forget saved credentials or unlock your operating system credential store.",
      );
    }
    if (saved) {
      let value: unknown;
      try {
        value = JSON.parse(saved);
      } catch {
        throw new Error("Saved credential is invalid. Forget it and enter credentials again.");
      }
      if (
        !value ||
        typeof value !== "object" ||
        !("version" in value) ||
        value.version !== 1 ||
        !("binding" in value) ||
        value.binding !== binding ||
        !("password" in value) ||
        typeof value.password !== "string"
      )
        throw new Error(
          "Saved credential does not match this connection destination. Enter credentials again.",
        );
      return value.password;
    }
    const answer = await this.prompt(profile);
    if (!answer) throw new Error("Connection cancelled.");
    await this.set(profile, answer);
    return answer.password;
  }
  async forget(id: string): Promise<void> {
    this.revoked.add(id);
    this.sessions.delete(id);
    try {
      await this.secrets.delete(this.key(id));
    } catch {
      throw new Error("Could not delete the saved credential. Retry Forget Saved Credentials.");
    }
  }
  clearSession(id: string): void {
    this.sessions.delete(id);
  }
  dispose(): void {
    this.sessions.clear();
    this.revoked.clear();
  }
}
