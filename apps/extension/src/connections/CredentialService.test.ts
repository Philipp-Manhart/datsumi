import { randomUUID } from "node:crypto";

import type { ConnectionProfile } from "@datsumi/core";
import { describe, expect, it, vi } from "vitest";

import { CredentialService, type CredentialAnswer } from "./CredentialService";
function fixture() {
  const data = new Map<string, string>();
  const secrets = {
    get: vi.fn<(key: string) => Promise<string | undefined>>(async (key: string) => data.get(key)),
    store: vi.fn<(key: string, value: string) => Promise<void>>(
      async (key: string, value: string) => {
        data.set(key, value);
      },
    ),
    delete: vi.fn<(key: string) => Promise<void>>(async (key: string) => {
      data.delete(key);
    }),
  };
  const prompt = vi.fn<() => Promise<CredentialAnswer | undefined>>(async () => ({
    password: "sentinel-secret",
    mode: "session",
  }));
  const profile: ConnectionProfile = {
    id: randomUUID(),
    name: "demo",
    driverId: "postgres",
    family: "relational",
    configuration: {
      host: "localhost",
      port: 5432,
      database: "demo",
      username: "demo",
      tls: "verify",
      ca: "",
      readOnly: false,
    },
  };
  return {
    data,
    secrets,
    prompt,
    profile,
    service: new CredentialService(secrets, prompt, "local"),
  };
}
describe("credential boundary", () => {
  it("stores versioned secrets separately from profiles, restores them, and forgets them", async () => {
    const { profile, service, data, secrets, prompt } = fixture();
    await service.set(profile, { password: "sentinel-secret", mode: "save" });
    expect(JSON.stringify(profile)).not.toContain("sentinel-secret");
    expect([...data.keys()][0]).toBe(`datsumi.credential.v1.${profile.id}`);
    const restored = new CredentialService(secrets, prompt, "local");
    expect(await restored.resolve(profile)).toBe("sentinel-secret");
    expect(prompt).not.toHaveBeenCalled();
    await restored.forget(profile.id);
    expect(data.size).toBe(0);
  });
  it("never persists session or ask-mode passwords", async () => {
    const { profile, service, data, prompt } = fixture();
    await service.set(profile, { password: "session-password", mode: "session" });
    expect(await service.resolve(profile)).toBe("session-password");
    expect(data.size).toBe(0);
    service.dispose();
    await service.set(profile, { password: "once", mode: "ask" });
    await service.resolve(profile);
    expect(prompt).toHaveBeenCalledOnce();
    expect(data.size).toBe(0);
  });
  /* oxlint-disable no-await-in-loop -- Verify each rejected destination independently against the same stored credential. */
  it("rejects destination, TLS policy, driver, and remote-host changes before releasing a secret", async () => {
    const { profile, service, secrets, prompt } = fixture();
    await service.set(profile, { password: "saved", mode: "save" });
    for (const configuration of [
      { ...profile.configuration, host: "attacker.example" },
      { ...profile.configuration, tls: "disable" },
      { ...profile.configuration, port: 9999 },
    ])
      await expect(service.resolve({ ...profile, configuration })).rejects.toThrow(
        "does not match",
      );
    await expect(service.resolve({ ...profile, driverId: "mysql" })).rejects.toThrow(
      "does not match",
    );
    await expect(
      new CredentialService(secrets, prompt, "ssh:other-host").resolve(profile),
    ).rejects.toThrow("does not match");
    expect(prompt).not.toHaveBeenCalled();
  });
  it("does not silently fall back after keychain errors or expose the underlying exception", async () => {
    const { profile, service, secrets, data, prompt } = fixture();
    secrets.store.mockRejectedValueOnce(new Error("sentinel-secret"));
    await expect(
      service.set(profile, { password: "sentinel-secret", mode: "save" }),
    ).rejects.toThrow("Secure credential storage");
    expect(data.size).toBe(0);
    secrets.get.mockRejectedValueOnce(new Error("sentinel-secret"));
    await expect(new CredentialService(secrets, prompt, "local").resolve(profile)).rejects.toThrow(
      "could not be read",
    );
    secrets.delete.mockRejectedValueOnce(new Error("sentinel-secret"));
    await expect(service.forget(profile.id)).rejects.toThrow("Could not delete");
  });
  it("can create session-only connections without a working keychain", async () => {
    const { profile, service, secrets } = fixture();
    secrets.delete.mockRejectedValue(new Error("keychain locked"));
    await service.set(profile, { password: "ephemeral", mode: "session" }, true);
    expect(await service.resolve(profile)).toBe("ephemeral");
    expect(secrets.get).not.toHaveBeenCalled();
    expect(secrets.store).not.toHaveBeenCalled();
  });
  it("handles cancelled and corrupt credentials without connecting", async () => {
    const { profile, service, data, prompt } = fixture();
    prompt.mockResolvedValueOnce(undefined);
    await expect(service.resolve(profile)).rejects.toThrow("cancelled");
    data.set(`datsumi.credential.v1.${profile.id}`, "{broken");
    await expect(service.resolve(profile)).rejects.toThrow("invalid");
  });
});

it("does not reuse revoked credentials even if the backend returns a stale deleted value", async () => {
  const { profile, service, secrets, prompt, data } = fixture();
  await service.set(profile, { password: "old-secret", mode: "save" });
  const oldValue = [...data.values()][0]!;
  secrets.get.mockResolvedValue(oldValue);
  await service.forget(profile.id);
  expect(await service.resolve(profile)).toBe("sentinel-secret");
  expect(prompt).toHaveBeenCalledOnce();
  expect(secrets.get).not.toHaveBeenCalled();
});
it("revokes an in-flight keychain read before it can return an old credential", async () => {
  const { profile, service, secrets, prompt, data } = fixture();
  await service.set(profile, { password: "old-secret", mode: "save" });
  const oldValue = [...data.values()][0]!;
  let finish: (value: string) => void = () => {};
  secrets.get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const pending = service.resolve(profile);
  await service.forget(profile.id);
  finish(oldValue);
  expect(await pending).toBe("sentinel-secret");
  expect(prompt).toHaveBeenCalledOnce();
});
it("fails closed in memory when deleting a saved credential fails", async () => {
  const { profile, service, secrets, prompt } = fixture();
  await service.set(profile, { password: "old-secret", mode: "save" });
  secrets.delete.mockRejectedValueOnce(new Error("keyring unavailable"));
  await expect(service.forget(profile.id)).rejects.toThrow("Could not delete");
  expect(await service.resolve(profile)).toBe("sentinel-secret");
  expect(prompt).toHaveBeenCalledOnce();
  expect(secrets.get).not.toHaveBeenCalled();
});
