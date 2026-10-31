import { jsonEntries, type JsonEntry } from "@datsumi/core";

export function documentFields(text: string): JsonEntry[] {
  try {
    return jsonEntries(text).children;
  } catch {
    return [];
  }
}
export function displayValue(entry: JsonEntry | undefined): string {
  if (!entry) return "—";
  const wrapper = entry.children.length === 1 ? entry.children[0] : undefined;
  if (
    wrapper &&
    ["$oid", "$numberInt", "$numberLong", "$numberDecimal", "$numberDouble"].includes(wrapper.key)
  ) {
    try {
      return String(JSON.parse(wrapper.raw));
    } catch {
      return wrapper.raw;
    }
  }
  if (wrapper?.key === "$date") {
    const raw = wrapper.children[0]?.raw ?? wrapper.raw;
    try {
      const value = JSON.parse(raw);
      const date = new Date(
        typeof value === "string" && /^[-\d]+$/.test(value) ? Number(value) : value,
      );
      return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
    } catch {
      return raw;
    }
  }
  if (wrapper?.key === "$binary") return "Binary value";
  if (entry.children.length)
    return entry.raw.startsWith("[")
      ? `[${entry.children.length} items]`
      : `{${entry.children.length} fields}`;
  try {
    const value: unknown = JSON.parse(entry.raw);
    return typeof value === "string" ? value || "(empty text)" : entry.raw;
  } catch {
    return entry.raw;
  }
}
export function recordLabel(id: string): string {
  try {
    const fields = jsonEntries(id);
    return displayValue(fields);
  } catch {
    return id;
  }
}
export function expiryLabel(ttl: number | undefined): string {
  if (ttl === undefined) return "";
  if (ttl === -1) return "No expiry";
  if (ttl < 0) return "Expired";
  const seconds = Math.ceil(ttl / 1000);
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}
