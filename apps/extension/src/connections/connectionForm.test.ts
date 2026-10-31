import type { ConnectionFormValues } from "@datsumi/protocol";
import { describe, it, expect } from "vitest";

import { serverFormSetup } from "./connectionForm";
const values: ConnectionFormValues = {
  driver: "postgres",
  mode: "fields",
  name: "",
  url: "",
  host: "localhost",
  port: "5432",
  database: "app",
  username: "postgres",
  password: "secret",
  credentialMode: "session",
  tls: true,
  ca: "",
  readOnly: false,
  path: "",
  create: false,
};
describe("connection form validation", () => {
  it("validates typed settings and separates password from persisted configuration", () => {
    const setup = serverFormSetup(values);
    expect(setup.name).not.toBe("");
    expect(setup.password).toBe("secret");
    expect(setup.configuration).toMatchObject({ host: "localhost", port: 5432, tls: "verify" });
    expect(JSON.stringify(setup.configuration)).not.toContain("secret");
    expect(() => serverFormSetup({ ...values, port: "99999" })).toThrow("Port");
  });
  it("validates URL engines and preserves custom MongoDB options", () => {
    const setup = serverFormSetup({
      ...values,
      driver: "mongodb",
      mode: "url",
      url: "mongodb://demo:old@localhost:27017/app?authSource=admin&tls=false",
      username: "demo",
      readOnly: true,
    });
    expect(setup.configuration).toMatchObject({
      endpoint: "mongodb://localhost:27017/app?authSource=admin&tls=false",
      username: "demo",
      readOnly: true,
    });
    expect(setup.password).toBe("secret");
    expect(() =>
      serverFormSetup({ ...values, mode: "url", url: "redis://localhost:6379/0" }),
    ).toThrow("does not match");
  });
});

it("connects sanitized URLs with separately entered credentials for every SQL engine", () => {
  for (const driver of ["postgres", "mysql", "mariadb", "mssql", "oracle", "clickhouse"] as const) {
    const setup = serverFormSetup({
      ...values,
      driver,
      mode: "url",
      url: `${driver}://localhost/app`,
    });
    expect(setup.driver).toBe(driver);
    expect(setup.configuration).toMatchObject({ username: "postgres", tls: "verify" });
    expect(setup.password).toBe("secret");
  }
});
it("preserves Neon required channel binding and Supabase session connection settings", () => {
  const neon = serverFormSetup({
    ...values,
    provider: "neon",
    mode: "url",
    url: "postgresql://owner:encoded%21@ep-example.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    username: "",
    password: "",
  });
  expect(neon.driver).toBe("postgres");
  expect(neon.configuration).toMatchObject({
    host: "ep-example.eu-central-1.aws.neon.tech",
    tls: "verify",
    channelBindingRequired: true,
    username: "owner",
  });
  expect(neon.password).toBe("encoded!");
  expect(JSON.stringify(neon.configuration)).not.toContain("encoded");
  const supabase = serverFormSetup({
    ...values,
    provider: "supabase",
    mode: "url",
    url: "postgresql://aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require",
    username: "postgres.projectref",
  });
  expect(supabase.configuration).toMatchObject({
    port: 5432,
    username: "postgres.projectref",
    tls: "verify",
  });
});
it("rejects unsafe cloud preset settings and transaction poolers", () => {
  expect(() => serverFormSetup({ ...values, provider: "neon", tls: false })).toThrow(
    "verified TLS",
  );
  expect(() => serverFormSetup({ ...values, provider: "supabase", driver: "mysql" })).toThrow(
    "PostgreSQL",
  );
  for (const [provider, url] of [
    ["neon", "postgres://u:p@ep-test-pooler.neon.tech/app?sslmode=require"],
    ["supabase", "postgres://u:p@pooler.supabase.com:6543/app?sslmode=require"],
  ] as const)
    expect(() => serverFormSetup({ ...values, provider, mode: "url", url })).toThrow(
      "Transaction poolers",
    );
});

it("validates SSH separately and rejects MongoDB discovery through a single-target tunnel", () => {
  const ssh = {
    enabled: true,
    host: "vps",
    port: "22",
    username: "ssh-user",
    keyPath: "~/.ssh/id_ed25519",
  };
  const setup = serverFormSetup({ ...values, ssh });
  expect(setup.ssh).toEqual({
    host: "vps",
    port: 22,
    username: "ssh-user",
    keyPath: "~/.ssh/id_ed25519",
  });
  expect(setup.configuration).not.toHaveProperty("tunnelPort");
  expect(() => serverFormSetup({ ...values, ssh: { ...ssh, port: "0" } })).toThrow("SSH");
  expect(() =>
    serverFormSetup({
      ...values,
      ssh,
      driver: "mongodb",
      mode: "url",
      url: "mongodb+srv://cluster.example/db",
    }),
  ).toThrow("direct mongodb");
});

it.each(["libsql", "turso"] as const)("separates %s tokens from profile settings", (driver) => {
  const setup = serverFormSetup({
    ...values,
    driver,
    mode: "url",
    url: "libsql://example.turso.io",
    password: "private-token",
  });
  expect(setup.configuration).toMatchObject({
    endpoint: "https://example.turso.io",
    database: "main",
    tls: "verify",
  });
  expect(setup.password).toBe("private-token");
  expect(JSON.stringify(setup.configuration)).not.toContain("private-token");
  expect(setup.name).toBe(`${driver} · example.turso.io`);
  expect(() =>
    serverFormSetup({ ...values, driver, url: "https://example.com?token=private-token" }),
  ).toThrow("token separately");
  expect(() =>
    serverFormSetup({
      ...values,
      driver,
      url: "https://example.com",
      ssh: { enabled: true, host: "vps", port: "22", username: "me", keyPath: "" },
    }),
  ).toThrow("do not support built-in SSH");
});
