import { parseNoSqlConfiguration } from "@datsumi/driver-nosql/configuration";
import {
  parseServerConfiguration,
  parseRemoteConfiguration,
} from "@datsumi/driver-sql/configuration";
import type { ConnectionFormValues } from "@datsumi/protocol";

import { databaseTunnelTarget } from "./ConnectionManager";
import { parseConnectionUrl, type ConnectionSetup } from "./connectionUrls";
import { parseSshConfiguration } from "./SshTunnel";

export function serverFormSetup(values: ConnectionFormValues): ConnectionSetup {
  if (values.driver === "sqlite" || values.driver === "duckdb")
    throw new Error("Choose a server database.");
  let setup: ConnectionSetup;
  if (values.driver === "libsql" || values.driver === "turso") {
    const configuration = parseRemoteConfiguration({
      endpoint: values.url,
      readOnly: values.readOnly,
    });
    setup = {
      driver: values.driver,
      name: values.name.trim() || `${values.driver} · ${configuration.host}`,
      configuration,
      password: values.password,
    };
  } else if (values.mode === "url") {
    setup = parseConnectionUrl(values.url, {
      username: values.username,
      password: values.password,
    });
    if (setup.driver !== values.driver)
      throw new Error("The URL does not match the selected database type.");
    setup = {
      ...setup,
      configuration: {
        ...setup.configuration,
        username: values.username || setup.configuration.username,
        readOnly: values.readOnly,
      },
    };
  } else if (values.driver === "mongodb" || values.driver === "redis") {
    const scheme = values.driver === "mongodb" ? "mongodb" : values.tls ? "rediss" : "redis";
    const host =
      values.host.includes(":") && !values.host.startsWith("[") ? `[${values.host}]` : values.host;
    const url = `${scheme}://${host}:${values.port}/${encodeURIComponent(values.database)}${values.driver === "mongodb" ? `?authSource=admin&tls=${values.tls}` : ""}`;
    setup = {
      driver: values.driver,
      name: values.name,
      configuration: parseNoSqlConfiguration(values.driver, {
        endpoint: url,
        username: values.username,
        readOnly: values.readOnly,
      }),
    };
  } else {
    setup = {
      driver: values.driver,
      name: values.name,
      configuration: parseServerConfiguration({
        host: values.host,
        port: Number(values.port),
        database: values.database,
        username: values.username,
        tls: values.tls ? "verify" : "disable",
        ca: values.ca,
        readOnly: values.readOnly,
      }),
    };
  }
  if ("tls" in setup.configuration && values.ca)
    setup = {
      ...setup,
      configuration: parseServerConfiguration({ ...setup.configuration, ca: values.ca }),
    };
  if (values.provider && values.provider !== "standard") {
    if (
      setup.driver !== "postgres" ||
      !("tls" in setup.configuration) ||
      setup.configuration.tls !== "verify"
    )
      throw new Error("Neon and Supabase presets require PostgreSQL with verified TLS.");
    const config = setup.configuration;
    if (
      (values.provider === "neon" && config.host.includes("-pooler.")) ||
      (values.provider === "supabase" && config.port === 6543)
    )
      throw new Error(
        "Use a direct connection or Supabase session pooler (port 5432). Transaction poolers do not preserve editor sessions.",
      );
  }
  const ssh = values.ssh?.enabled
    ? parseSshConfiguration({
        host: values.ssh.host,
        port: Number(values.ssh.port),
        username: values.ssh.username,
        keyPath: values.ssh.keyPath,
      })
    : undefined;
  if (ssh)
    databaseTunnelTarget({
      id: "test",
      name: setup.name,
      driverId: setup.driver,
      family:
        setup.driver === "mongodb"
          ? "document"
          : setup.driver === "redis"
            ? "key-value"
            : "relational",
      configuration: { ...setup.configuration },
    });
  return {
    ...setup,
    ...(ssh ? { ssh } : {}),
    name:
      values.name.trim() || setup.name || `${values.driver} · ${values.host}/${values.database}`,
    password: values.password || setup.password || "",
  };
}
