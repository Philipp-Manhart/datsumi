/* oxlint-disable react-perf/jsx-no-new-function-as-prop -- Value actions carry their displayed row. */

import { JsonInspector } from "./JsonInspector";
export function RedisValue({
  record,
  copy,
}: {
  record: { id: string; text: string; editable: boolean; type?: string | undefined };
  copy: (text: string) => void;
}) {
  if (record.type === "string" && !/^\s*[[{]/.test(record.text))
    return <pre className="redis-text">{record.text || "(empty string)"}</pre>;
  let parsed: unknown;
  try {
    parsed = JSON.parse(record.text);
  } catch {
    return <pre className="redis-text">{record.text || "(empty string)"}</pre>;
  }
  const object =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  if (
    record.type === "hash" &&
    object &&
    Object.values(object).every((value) => typeof value === "string")
  )
    return (
      <table className="redis-value-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(object).map(([name, value]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{String(value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  if (record.type === "list" && object && Array.isArray(object.first100))
    return (
      <>
        <p>
          {String(object.length)} items · showing the first {object.first100.length}
        </p>
        <table className="redis-value-table">
          <thead>
            <tr>
              <th>Index</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            {object.first100.map((value, index) => (
              <tr key={index}>
                <td>{index}</td>
                <td>{String(value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    );
  if (record.type === "zset" && object && Array.isArray(object.first100))
    return (
      <>
        <p>
          {String(object.size)} members · showing the first {object.first100.length}
        </p>
        <table className="redis-value-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {object.first100.map((item, index) => {
              const row = item as { value: string; score: number };
              return (
                <tr key={index}>
                  <td>{row.value}</td>
                  <td>{row.score}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </>
    );
  if (record.type === "set" && object) {
    const scan = object.scan as { members?: string[]; cursor?: string } | undefined;
    if (Array.isArray(scan?.members))
      return (
        <>
          <p>
            {String(object.size)} members · scan batch ({scan.members.length} shown)
          </p>
          <table className="redis-value-table">
            <thead>
              <tr>
                <th>Member</th>
              </tr>
            </thead>
            <tbody>
              {scan.members.map((member) => (
                <tr key={member}>
                  <td>{member}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      );
  }
  return <JsonInspector text={record.text} copy={copy} />;
}
