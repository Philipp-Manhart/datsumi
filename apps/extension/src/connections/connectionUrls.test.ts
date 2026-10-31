import { describe, expect, it } from "vitest";

import { parseConnectionUrl } from "./connectionUrls";
describe("connection URL import", () => {
  it("separates encoded credentials and defaults to verified TLS", () => {
    const result = parseConnectionUrl("postgresql://user:p%40ss@example.com/app?sslmode=require");
    expect(result.password).toBe("p@ss");
    expect(result.configuration).toMatchObject({
      host: "example.com",
      username: "user",
      tls: "verify",
      port: 5432,
    });
    expect(JSON.stringify(result.configuration)).not.toContain("p@ss");
  });
  it("supports SQL and non-SQL engines without persisting credentials", () => {
    for (const [url, driver] of [
      ["mysql://u:p@localhost/app", "mysql"],
      ["mariadb://u:p@localhost/app", "mariadb"],
      ["sqlserver://sa:p@localhost/master", "mssql"],
      ["mongodb+srv://u:p@cluster.example/app?authSource=admin", "mongodb"],
      ["rediss://default:p@localhost:6380/0", "redis"],
    ]) {
      const result = parseConnectionUrl(url!);
      expect(result.driver).toBe(driver);
      expect(result.password).toBe("p");
      expect(JSON.stringify(result.configuration)).not.toContain(":p@");
    }
  });
  it("rejects unsupported security options, duplicates, and secret-bearing endpoint settings", () => {
    for (const url of [
      "postgres://u:p@host/db?sslmode=prefer",
      "postgres://u:p@host/db?sslmode=disable&sslmode=require",
      "mongodb://u:p@host/db?tlsAllowInvalidCertificates=true",
      "redis://u:p@host/0?password=p",
      "postgres://u:p@host/db#secret",
    ])
      expect(() => parseConnectionUrl(url)).toThrow(/./);
  });
});

it("validates channel binding and uses each new engine's secure default port", () => {
  expect(
    parseConnectionUrl("clickhouse://user:secret@db.example/default").configuration,
  ).toMatchObject({ port: 8443, tls: "verify" });
  expect(
    parseConnectionUrl("clickhouse://user:secret@localhost/default?ssl=false").configuration,
  ).toMatchObject({ port: 8123, tls: "disable" });
  expect(
    parseConnectionUrl("oracle://user:secret@db.example/FREEPDB1").configuration,
  ).toMatchObject({ port: 1521, database: "FREEPDB1", tls: "verify" });
  expect(() =>
    parseConnectionUrl("postgres://u:p@db/app?ssl=false&channel_binding=require"),
  ).toThrow("verified TLS");
  expect(() => parseConnectionUrl("mysql://u:p@db/app?channel_binding=require")).toThrow(
    "channel binding",
  );
  expect(() =>
    parseConnectionUrl("postgres://u:p@db/app?channel_binding=require&channel_binding=disable"),
  ).toThrow("Duplicate");
});

it("accepts ClickHouse HTTP(S) URLs without weakening their transport", () => {
  expect(
    parseConnectionUrl("https://user:secret@warehouse.example:8443").configuration,
  ).toMatchObject({ port: 8443, database: "default", tls: "verify" });
  expect(parseConnectionUrl("https://warehouse.example/default").configuration).toMatchObject({
    port: 443,
    username: "default",
  });
  expect(parseConnectionUrl("http://localhost:8123/default").configuration).toMatchObject({
    port: 8123,
    tls: "disable",
  });
  expect(() =>
    parseConnectionUrl("https://user:secret@warehouse.example/default?ssl=false"),
  ).toThrow("conflicts");
});
