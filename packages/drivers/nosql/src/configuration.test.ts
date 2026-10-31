import { expect, it } from "vitest";

import { parseNoSqlConfiguration } from "./configuration";
it("rejects credentials in persisted endpoints, unsafe options, and unexpected fields", () => {
  for (const configuration of [
    { endpoint: "mongodb://u:p@host/db", username: "u", readOnly: false },
    { endpoint: "mongodb://host/db?tlsInsecure=true", username: "u", readOnly: false },
    { endpoint: "mongodb://host/db", username: "u", readOnly: false, password: "p" },
  ])
    expect(() => parseNoSqlConfiguration("mongodb", configuration)).toThrow(/./);
});
it("accepts explicit local TLS disablement and verified hosted endpoints", () => {
  expect(
    parseNoSqlConfiguration("mongodb", {
      endpoint: "mongodb://localhost/db?tls=false",
      username: "",
      readOnly: true,
    }).readOnly,
  ).toBe(true);
  expect(
    parseNoSqlConfiguration("redis", {
      endpoint: "rediss://host:6380/0",
      username: "default",
      readOnly: false,
    }).endpoint,
  ).toContain("rediss:");
});
