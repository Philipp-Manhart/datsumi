/* oxlint-disable no-control-regex -- Reject control characters in connection settings. */
export const nosqlDrivers = ["mongodb", "redis"] as const;
export type NoSqlDriver = (typeof nosqlDrivers)[number];
export const nosqlNames = { mongodb: "MongoDB", redis: "Redis" };
export function isNoSqlDriver(value: unknown): value is NoSqlDriver {
  return value === "mongodb" || value === "redis";
}
export interface NoSqlConfiguration {
  /** Ephemeral loopback forwarding port; never saved in profiles. */
  tunnelPort?: number;
  endpoint: string;
  username: string;
  readOnly: boolean;
}
export function parseNoSqlConfiguration(id: NoSqlDriver, value: unknown): NoSqlConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid connection settings.");
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some((k) => !["endpoint", "username", "readOnly"].includes(k)) ||
    typeof data.endpoint !== "string" ||
    typeof data.username !== "string" ||
    typeof data.readOnly !== "boolean" ||
    data.endpoint.length > 4096 ||
    data.username.length > 500 ||
    /[\x00-\x1f]/.test(data.endpoint + data.username)
  )
    throw new Error("Invalid connection settings.");
  const uri = new URL(data.endpoint);
  if (
    uri.username ||
    uri.password ||
    uri.hash ||
    !uri.hostname ||
    !(id === "mongodb" ? ["mongodb:", "mongodb+srv:"] : ["redis:", "rediss:"]).includes(
      uri.protocol,
    )
  )
    throw new Error("Use a database URL without embedded credentials.");
  const allowed =
    id === "mongodb"
      ? ["authSource", "replicaSet", "directConnection", "tls", "retryWrites", "readPreference"]
      : [];
  for (const [key, option] of uri.searchParams) {
    if (uri.searchParams.getAll(key).length > 1)
      throw new Error("Duplicate connection options are unsupported.");
    if (!allowed.includes(key) || (key === "tls" && !["true", "false"].includes(option)))
      throw new Error(`Unsupported connection option: ${key}`);
  }
  if (id === "mongodb" && (!uri.pathname || uri.pathname === "/"))
    throw new Error("Include the database name in the URL.");
  if (id === "redis" && !/^\/(?:\d+)?$/.test(uri.pathname))
    throw new Error("Redis URL database must be a number.");
  return { endpoint: data.endpoint, username: data.username, readOnly: data.readOnly };
}
