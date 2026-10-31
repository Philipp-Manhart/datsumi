import { X509Certificate } from "node:crypto";

export const serverDrivers = [
  "postgres",
  "mysql",
  "mariadb",
  "mssql",
  "clickhouse",
  "oracle",
  "libsql",
  "turso",
] as const;
export type ServerDriver = (typeof serverDrivers)[number];
export const driverNames: Record<ServerDriver, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mssql: "SQL Server",
  clickhouse: "ClickHouse",
  oracle: "Oracle",
  libsql: "libSQL",
  turso: "Turso",
};
export interface ServerConfiguration {
  endpoint?: string;
  /** Ephemeral loopback forwarding port; never saved in profiles. */
  tunnelPort?: number;
  host: string;
  port: number;
  database: string;
  username: string;
  tls: "verify" | "disable";
  ca: string;
  readOnly: boolean;
  channelBindingRequired?: boolean;
  enableChannelBinding?: boolean;
}
export function isServerDriver(value: unknown): value is ServerDriver {
  return serverDrivers.some((driver) => driver === value);
}
export function parseServerConfiguration(value: unknown): ServerConfiguration {
  if (!value || typeof value !== "object") throw new Error("Invalid server connection settings.");
  if ("endpoint" in value) return parseRemoteConfiguration(value);
  const allowed = new Set([
    "host",
    "port",
    "database",
    "username",
    "tls",
    "ca",
    "readOnly",
    "channelBindingRequired",
    "enableChannelBinding",
  ]);
  for (const key of Object.keys(value))
    if (!allowed.has(key)) throw new Error(`Unsupported connection setting: ${key}`);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Shape is checked field by field immediately below.
  const config = value as Record<string, unknown>;
  for (const key of ["host", "database", "username"] as const)
    if (
      typeof config[key] !== "string" ||
      !config[key].trim() ||
      config[key].length > 1024 ||
      config[key].split("").some((char) => char.charCodeAt(0) < 32)
    )
      throw new Error(`A valid ${key} is required.`);
  if (
    typeof config.port !== "number" ||
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535
  )
    throw new Error("Port must be between 1 and 65535.");
  if (config.tls !== "verify" && config.tls !== "disable")
    throw new Error("Choose verified TLS or explicitly disable TLS.");
  if (
    typeof config.readOnly !== "boolean" ||
    typeof config.ca !== "string" ||
    config.ca.length > 1024 * 1024
  )
    throw new Error("Invalid TLS or access settings.");
  if (config.ca.trim()) {
    const blocks = config.ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
    if (
      !blocks?.length ||
      config.ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, "").trim()
    )
      throw new Error("Custom CA must contain only PEM certificates, never private keys.");
    try {
      for (const block of blocks) new X509Certificate(block);
    } catch {
      throw new Error("Custom CA contains an invalid certificate.");
    }
  }
  if (
    config.channelBindingRequired !== undefined &&
    typeof config.channelBindingRequired !== "boolean"
  )
    throw new Error("Invalid channel binding setting.");
  if (config.enableChannelBinding !== undefined && typeof config.enableChannelBinding !== "boolean")
    throw new Error("Invalid channel binding setting.");
  if (config.channelBindingRequired && config.enableChannelBinding === false)
    throw new Error("Required channel binding cannot be disabled.");
  if (config.channelBindingRequired && config.tls !== "verify")
    throw new Error("Channel binding requires verified TLS.");
  return {
    ...(config.enableChannelBinding !== undefined
      ? { enableChannelBinding: config.enableChannelBinding }
      : {}),
    ...(config.channelBindingRequired !== undefined
      ? { channelBindingRequired: config.channelBindingRequired }
      : {}),
    host: String(config.host).trim(),
    port: config.port,
    database: String(config.database),
    username: String(config.username),
    tls: config.tls,
    ca: config.ca,
    readOnly: config.readOnly,
  };
}

/** HTTP-only remote SQLite endpoints. Tokens must never be embedded in saved URLs. */
export function parseRemoteConfiguration(value: unknown): ServerConfiguration {
  if (!value || typeof value !== "object") throw new Error("Invalid remote SQL settings.");
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Settings are validated below.
  const config = value as Record<string, unknown>;
  const allowed = new Set([
    "endpoint",
    "readOnly",
    "host",
    "port",
    "database",
    "username",
    "tls",
    "ca",
  ]);
  if (Object.keys(config).some((key) => !allowed.has(key)))
    throw new Error("Unsupported remote SQL setting.");
  if (
    typeof config.endpoint !== "string" ||
    config.endpoint.length > 8192 ||
    config.endpoint.split("").some((c) => c.charCodeAt(0) <= 32)
  )
    throw new Error("Enter a valid database URL.");
  let url: URL;
  try {
    url = new URL(config.endpoint.replace(/^libsql:/i, "https:"));
  } catch {
    throw new Error("Enter a valid database URL.");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.port !== "" && Number(url.port) < 1)
  )
    throw new Error(
      "Use an HTTP(S) or libsql:// database URL without credentials, query parameters or fragments. Enter the token separately.",
    );
  if (typeof config.readOnly !== "boolean") throw new Error("Choose an access mode.");
  if (config.ca)
    throw new Error("Custom CA certificates are not supported by remote libSQL/Turso adapters.");
  return {
    endpoint: url.toString().replace(/\/$/, ""),
    host: url.hostname,
    port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    database: "main",
    username: "token",
    tls: url.protocol === "https:" ? "verify" : "disable",
    ca: "",
    readOnly: config.readOnly,
  };
}

export function parseSqlConfiguration(driver: ServerDriver, value: unknown): ServerConfiguration {
  const remote = driver === "libsql" || driver === "turso";
  if (remote) return parseRemoteConfiguration(value);
  if (value && typeof value === "object" && "endpoint" in value)
    throw new Error("This database requires server connection fields.");
  return parseServerConfiguration(value);
}
