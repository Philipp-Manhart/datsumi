import { isAbsolute } from "node:path";

export interface DuckDbConfiguration {
  path: string;
  readOnly: boolean;
}
export function parseDuckDbConfiguration(value: unknown): DuckDbConfiguration {
  if (!value || typeof value !== "object") throw new Error("Invalid DuckDB settings.");
  const config = value as Record<string, unknown>;
  if (
    Object.keys(config).some((key) => key !== "path" && key !== "readOnly") ||
    typeof config.path !== "string" ||
    !config.path ||
    config.path.includes("\0") ||
    (config.path !== ":memory:" && !isAbsolute(config.path)) ||
    typeof config.readOnly !== "boolean" ||
    (config.path === ":memory:" && config.readOnly)
  )
    throw new Error("Choose an absolute local DuckDB file path or a writable in-memory database.");
  return { path: config.path, readOnly: config.readOnly };
}
