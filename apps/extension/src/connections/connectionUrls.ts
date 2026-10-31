import type { SshConfiguration } from "@datsumi/core";
/* oxlint-disable no-control-regex -- Reject control characters in connection settings. */
import {
  isNoSqlDriver,
  parseNoSqlConfiguration,
  type NoSqlConfiguration,
  type NoSqlDriver,
} from "@datsumi/driver-nosql/configuration";
import {
  isServerDriver,
  parseServerConfiguration,
  type ServerConfiguration,
  type ServerDriver,
} from "@datsumi/driver-sql/configuration";
export type ConnectionSetup = {
  driver: ServerDriver | NoSqlDriver;
  name: string;
  configuration: ServerConfiguration | NoSqlConfiguration;
  password?: string;
  ssh?: SshConfiguration;
};
export function parseConnectionUrl(
  text: string,
  credentials?: { username: string; password: string },
): ConnectionSetup {
  if (text.length > 8192 || /[\x00-\x1f]/.test(text)) throw new Error("Invalid connection URL.");
  const uri = new URL(text);
  const scheme = uri.protocol.slice(0, -1);
  const driver =
    scheme === "http" || scheme === "https"
      ? "clickhouse"
      : scheme === "postgresql"
        ? "postgres"
        : scheme === "mongodb+srv"
          ? "mongodb"
          : scheme === "rediss"
            ? "redis"
            : scheme === "sqlserver"
              ? "mssql"
              : scheme;
  if (!isServerDriver(driver) && !isNoSqlDriver(driver))
    throw new Error("Unsupported database URL scheme.");
  const username = credentials?.username || decodeURIComponent(uri.username),
    password = credentials?.password || decodeURIComponent(uri.password);
  uri.username = "";
  uri.password = "";
  if (uri.hash) throw new Error("URL fragments are unsupported.");
  if (isNoSqlDriver(driver)) {
    const configuration = parseNoSqlConfiguration(driver, {
      endpoint: uri.toString(),
      username,
      readOnly: false,
    });
    return { driver, name: `${driver} · ${uri.hostname}`, configuration, password };
  }
  for (const key of uri.searchParams.keys())
    if (!["sslmode", "ssl", "encrypt", "channel_binding"].includes(key))
      throw new Error(`Unsupported URL option: ${key}. Configure it explicitly instead.`);
  for (const key of ["sslmode", "ssl", "encrypt", "channel_binding"])
    if (uri.searchParams.getAll(key).length > 1)
      throw new Error("Duplicate URL options are unsupported.");
  if (["sslmode", "ssl", "encrypt"].filter((key) => uri.searchParams.has(key)).length > 1)
    throw new Error("Conflicting TLS options are unsupported.");
  const tlsOption =
    uri.searchParams.get("sslmode") ??
    uri.searchParams.get("ssl") ??
    uri.searchParams.get("encrypt");
  if (
    tlsOption &&
    !["disable", "false", "true", "require", "verify-full", "verify-ca"].includes(tlsOption)
  )
    throw new Error("Unsupported TLS mode. Choose verified TLS or explicit disablement.");
  const disableTls = ["disable", "false"].includes(tlsOption ?? "") || scheme === "http";
  if (
    (scheme === "https" && disableTls) ||
    (scheme === "http" && tlsOption && !["disable", "false"].includes(tlsOption))
  )
    throw new Error("URL protocol conflicts with TLS options. Use https for verified TLS.");
  const binding = uri.searchParams.get("channel_binding");
  if (binding && (driver !== "postgres" || !["require", "prefer", "disable"].includes(binding)))
    throw new Error("Unsupported channel binding option.");
  const configuration = parseServerConfiguration({
    ...(binding
      ? {
          channelBindingRequired: binding === "require",
          enableChannelBinding: binding !== "disable",
        }
      : {}),
    host: uri.hostname.replace(/^\[|\]$/g, ""),
    port: uri.port
      ? Number(uri.port)
      : scheme === "http"
        ? 80
        : scheme === "https"
          ? 443
          : driver === "clickhouse"
            ? ["disable", "false"].includes(tlsOption ?? "")
              ? 8123
              : 8443
            : driver === "oracle"
              ? 1521
              : driver === "postgres"
                ? 5432
                : driver === "mssql"
                  ? 1433
                  : 3306,
    database:
      decodeURIComponent(uri.pathname.slice(1)) || (driver === "clickhouse" ? "default" : ""),
    username: username || (driver === "clickhouse" ? "default" : ""),
    tls: disableTls ? "disable" : "verify",
    ca: "",
    readOnly: false,
  });
  return {
    driver,
    name: `${driver} · ${uri.hostname}/${configuration.database}`,
    configuration,
    password,
  };
}
