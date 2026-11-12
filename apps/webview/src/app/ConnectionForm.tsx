/* oxlint-disable react-perf/jsx-no-new-function-as-prop,react-perf/jsx-no-new-object-as-prop -- Form controls carry field names and values. */
import { connectionFormSchema, type ConnectionFormValues } from "@datsumi/protocol";
import { useEffect, useState } from "react";

import { getVsCodeApi } from "./vscode";

const drivers = {
  sqlite: "SQLite",
  duckdb: "DuckDB",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mariadb: "MariaDB",
  mssql: "SQL Server",
  clickhouse: "ClickHouse",
  oracle: "Oracle",
  libsql: "libSQL",
  turso: "Turso",
  mongodb: "MongoDB",
  redis: "Redis",
};
const defaults: ConnectionFormValues = {
  driver: "sqlite",
  ssh: { enabled: false, host: "", port: "22", username: "", keyPath: "" },
  mode: "fields",
  name: "",
  url: "",
  host: "localhost",
  port: "5432",
  database: "",
  username: "",
  password: "",
  credentialMode: "session",
  tls: true,
  ca: "",
  readOnly: false,
  path: "",
  create: false,
};
const vscode = getVsCodeApi();
const hostPostMessage = vscode ? (message: unknown) => vscode.postMessage(message) : undefined;
export function ConnectionForm({
  postMessage = hostPostMessage,
}: {
  postMessage?: (message: unknown) => void;
}) {
  const [formTitle, setFormTitle] = useState("Add Database Connection");
  const [values, setValues] = useState(defaults),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [status, setStatus] = useState<string | null>(null),
    [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      const data = event.data as {
        initial?: Partial<ConnectionFormValues>;
        title?: string;
        defaults?: { credentialMode?: "session" | "save" | "ask" };
        type?: string;
        busy?: boolean;
        error?: string | null;
        status?: string | null;
        path?: string;
        sshKeyPath?: string;
      };
      if (data?.type !== "connection/state") return;
      if (data.title) setFormTitle(data.title);
      if (data.initial) setValues((previous) => ({ ...previous, ...data.initial, password: "" }));
      if (data.defaults?.credentialMode)
        setValues((previous) => ({ ...previous, credentialMode: data.defaults!.credentialMode! }));
      if (data.busy !== undefined) setBusy(data.busy);
      if (data.error !== undefined) setError(data.error);
      if (data.status !== undefined) setStatus(data.status);
      if (data.sshKeyPath)
        setValues((previous) => ({
          ...previous,
          ssh: { ...defaults.ssh!, ...previous.ssh, keyPath: data.sshKeyPath! },
        }));
      if (data.path) setValues((previous) => ({ ...previous, path: data.path! }));
    };
    window.addEventListener("message", receive);
    postMessage?.({ type: "connection/ready" });
    return () => window.removeEventListener("message", receive);
  }, [postMessage]);
  const local = values.driver === "sqlite" || values.driver === "duckdb";
  const remote = values.driver === "libsql" || values.driver === "turso";
  const noSql = values.driver === "mongodb" || values.driver === "redis";
  const change = <K extends keyof ConnectionFormValues>(key: K, value: ConnectionFormValues[K]) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setError(null);
    setStatus(null);
  };
  const changeSsh = (patch: Partial<NonNullable<ConnectionFormValues["ssh"]>>) => {
    setValues((previous) => ({
      ...previous,
      ssh: { ...defaults.ssh!, ...previous.ssh, ...patch },
    }));
    setError(null);
    setStatus(null);
  };
  const importUrl = (text: string) => {
    if (remote) {
      change("url", text);
      return;
    }
    try {
      const url = new URL(text);
      const password = url.password ? decodeURIComponent(url.password) : values.password;
      const username = url.username ? decodeURIComponent(url.username) : values.username;
      url.username = "";
      url.password = "";
      setValues((previous) => ({ ...previous, url: url.toString(), username, password }));
    } catch {
      change("url", text);
    }
  };
  const submit = (test: boolean) => {
    setError(null);
    setStatus(null);
    if (local && !values.path.trim()) {
      setError("Choose a database file.");
      return;
    }
    if (!local && values.mode === "url" && !values.url.trim()) {
      setError("Enter a connection URL.");
      return;
    }
    if (
      !local &&
      values.mode === "fields" &&
      (!values.host.trim() ||
        !/^\d+$/.test(values.port) ||
        Number(values.port) < 1 ||
        Number(values.port) > 65535)
    ) {
      setError("Enter a host and a port between 1 and 65535.");
      return;
    }
    if (values.create && values.readOnly) {
      setError("A new database cannot be read-only.");
      return;
    }
    if (
      !local &&
      values.ssh?.enabled &&
      (!values.ssh.host.trim() ||
        !values.ssh.username.trim() ||
        !/^\d+$/.test(values.ssh.port) ||
        Number(values.ssh.port) < 1 ||
        Number(values.ssh.port) > 65535)
    ) {
      setError("Enter an SSH host, user and port between 1 and 65535.");
      return;
    }
    const parsed = connectionFormSchema.safeParse(values);
    if (!parsed.success) {
      setError("Check the connection fields.");
      return;
    }
    if (postMessage) {
      setBusy(true);
      postMessage({ type: "connection/submit", values: parsed.data, test });
    } else setStatus("Preview only. Open this form in VS Code to connect.");
  };
  return (
    <main className="connection-page">
      <form
        className="connection-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit(false);
        }}
      >
        <header>
          <h1>{formTitle}</h1>
          <p>Choose a database and enter its connection details.</p>
        </header>
        <fieldset disabled={busy}>
          <label>
            Database type
            <select
              aria-label="Database type"
              disabled={formTitle === "Edit Database Connection"}
              value={values.driver}
              onChange={(event) => {
                const driver = event.target.value as ConnectionFormValues["driver"];
                const port =
                  (
                    {
                      postgres: "5432",
                      mysql: "3306",
                      mariadb: "3306",
                      mssql: "1433",
                      clickhouse: "8443",
                      oracle: "1521",
                      mongodb: "27017",
                      redis: "6379",
                    } as Record<string, string>
                  )[driver] ?? "";
                setValues({
                  ...defaults,
                  credentialMode: values.credentialMode,
                  driver,
                  mode: ["libsql", "turso"].includes(driver) ? "url" : "fields",
                  port,
                  username:
                    driver === "postgres"
                      ? "postgres"
                      : driver === "mysql" || driver === "mariadb"
                        ? "root"
                        : driver === "mssql"
                          ? "sa"
                          : driver === "clickhouse"
                            ? "default"
                            : "",
                  database:
                    driver === "redis"
                      ? "0"
                      : driver === "clickhouse"
                        ? "default"
                        : driver === "oracle"
                          ? "FREEPDB1"
                          : "",
                  tls: !["sqlite", "duckdb"].includes(driver),
                });
                setError(null);
                setStatus(null);
              }}
            >
              {Object.entries(drivers).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {values.driver === "postgres" && (
            <label>
              Connection preset
              <select
                aria-label="Connection preset"
                value={values.provider ?? "standard"}
                onChange={(event) => {
                  const provider = event.target.value as "standard" | "neon" | "supabase";
                  setValues((previous) => ({
                    ...previous,
                    provider,
                    mode: provider === "standard" ? previous.mode : "url",
                    tls: true,
                    port: "5432",
                    database: provider === "neon" ? "neondb" : "postgres",
                    name: provider === "standard" ? "" : provider === "neon" ? "Neon" : "Supabase",
                  }));
                }}
              >
                <option value="standard">PostgreSQL</option>
                <option value="neon">Neon</option>
                <option value="supabase">Supabase</option>
              </select>
              {values.provider === "neon" && (
                <small>
                  Paste the direct connection URL from Neon. Verified TLS and requested channel
                  binding are preserved; use a host without “-pooler”.
                </small>
              )}
              {values.provider === "supabase" && (
                <small>
                  Paste the direct or session-pooler PostgreSQL URL. Session pooling on port 5432
                  also works on IPv4 networks. Transaction pooling on port 6543 is not supported.
                </small>
              )}
            </label>
          )}
          {["clickhouse", "oracle"].includes(values.driver) && (
            <p>
              Queries, browsing and export are supported.
              {values.driver === "clickhouse"
                ? " Grid editing is unavailable because this adapter cannot roll back an edit batch."
                : " Writable tables with primary keys support staged editing, review and confirmed commit."}
              {values.driver === "oracle"
                ? " Database is the Oracle service name. Writes stay pending until COMMIT; disconnect rolls them back. DDL can commit implicitly."
                : " Use the HTTP(S) port, normally 8123 locally or 8443 for ClickHouse Cloud. Transactions are not supported."}
            </p>
          )}
          {!local && (
            <label>
              Connection name
              <input
                aria-label="Connection name"
                placeholder={`${drivers[values.driver]} connection`}
                value={values.name}
                onChange={(event) => change("name", event.target.value)}
              />
            </label>
          )}
          {local ? (
            <>
              {local && (
                <label>
                  Database file mode
                  <select
                    aria-label="Database file mode"
                    value={values.create ? "create" : "open"}
                    onChange={(event) => change("create", event.target.value === "create")}
                  >
                    <option value="open">Open existing database</option>
                    <option value="create">Create database</option>
                  </select>
                </label>
              )}
              <label>
                Database file
                <div className="input-with-action">
                  <input
                    aria-label="Database file"
                    placeholder={
                      remote
                        ? "libsql://your-database.turso.io"
                        : values.driver === "duckdb"
                          ? "/path/to/database.duckdb or :memory:"
                          : "/path/to/database.sqlite"
                    }
                    value={values.path}
                    onChange={(event) => change("path", event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      postMessage?.({
                        type: "connection/browse",
                        driver: values.driver,
                        create: values.create,
                      })
                    }
                  >
                    Browse…
                  </button>
                </div>
              </label>
            </>
          ) : (
            <>
              {!remote && (
                <fieldset className="connection-modes" aria-label="Connection input">
                  <button
                    type="button"
                    aria-pressed={values.mode === "fields"}
                    onClick={() => change("mode", "fields")}
                  >
                    Connection fields
                  </button>
                  <button
                    type="button"
                    aria-pressed={values.mode === "url"}
                    onClick={() => change("mode", "url")}
                  >
                    Connection URL
                  </button>
                </fieldset>
              )}
              {values.mode === "url" ? (
                <label>
                  Connection URL
                  <input
                    type="text"
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Connection URL"
                    placeholder={
                      remote
                        ? "libsql://your-database.turso.io"
                        : values.driver === "mongodb"
                          ? "mongodb://localhost:27017/mydb?authSource=admin&tls=false"
                          : values.driver === "redis"
                            ? "redis://localhost:6379/0"
                            : values.driver === "clickhouse"
                              ? "https://your-host:8443/default"
                              : `${values.driver}://localhost:${values.port}/database`
                    }
                    value={values.url}
                    onChange={(event) => importUrl(event.target.value)}
                    onPaste={(event) => {
                      event.preventDefault();
                      importUrl(event.clipboardData.getData("text"));
                    }}
                  />
                  <small>
                    URL stays visible. Pasted usernames and passwords move into the fields below.
                  </small>
                </label>
              ) : (
                <>
                  <div className="connection-row">
                    <label>
                      Host
                      <input
                        aria-label="Host"
                        value={values.host}
                        onChange={(event) => change("host", event.target.value)}
                      />
                    </label>
                    <label>
                      Port
                      <input
                        aria-label="Port"
                        inputMode="numeric"
                        value={values.port}
                        onChange={(event) => change("port", event.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    {values.driver === "redis"
                      ? "Database number"
                      : values.driver === "oracle"
                        ? "Service name"
                        : "Database"}
                    <input
                      aria-label="Database"
                      value={values.database}
                      onChange={(event) => change("database", event.target.value)}
                    />
                  </label>
                </>
              )}
              {!remote && (
                <label>
                  Username
                  <input
                    aria-label="Username"
                    autoComplete="off"
                    value={values.username}
                    onChange={(event) => change("username", event.target.value)}
                  />
                </label>
              )}
              <label>
                {remote ? "Authentication token" : "Password"}
                <div className="input-with-action">
                  <input
                    aria-label={remote ? "Authentication token" : "Password"}
                    type={showPassword ? "text" : "password"}
                    autoComplete="off"
                    value={values.password}
                    onChange={(event) => change("password", event.target.value)}
                  />
                  <button
                    type="button"
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>
              <label>
                Remember credentials
                <select
                  aria-label="Remember credentials"
                  value={values.credentialMode}
                  onChange={(event) =>
                    change(
                      "credentialMode",
                      event.target.value as ConnectionFormValues["credentialMode"],
                    )
                  }
                >
                  <option value="session">For this session</option>
                  <option value="save">Save securely in VS Code</option>
                  <option value="ask">Ask each time</option>
                </select>
              </label>
              {values.mode === "fields" && (
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={values.tls}
                    onChange={(event) => change("tls", event.target.checked)}
                  />
                  Use verified TLS
                </label>
              )}
              {!remote && !noSql && (values.mode === "url" || values.tls) && (
                <details>
                  <summary>Custom CA certificate</summary>
                  <textarea
                    aria-label="CA certificate"
                    placeholder="Optional PEM certificate"
                    value={values.ca}
                    onChange={(event) => change("ca", event.target.value)}
                  />
                </details>
              )}
            </>
          )}
          {!local && !remote && (
            <section className="ssh-settings" aria-label="SSH tunnel">
              <label className="check-label">
                <input
                  type="checkbox"
                  aria-label="Connect via SSH"
                  checked={values.ssh?.enabled ?? false}
                  onChange={(event) => changeSsh({ enabled: event.target.checked })}
                />
                Connect via SSH
              </label>
              {values.ssh?.enabled && (
                <>
                  <p>
                    The database host above is reached from the SSH server. Use 127.0.0.1 if the
                    database runs on the same VPS. Database TLS remains a separate setting.
                  </p>
                  <div className="connection-row">
                    <label>
                      SSH host
                      <input
                        aria-label="SSH host"
                        value={values.ssh.host}
                        onChange={(event) => changeSsh({ host: event.target.value })}
                      />
                    </label>
                    <label>
                      SSH port
                      <input
                        aria-label="SSH port"
                        inputMode="numeric"
                        value={values.ssh.port}
                        onChange={(event) => changeSsh({ port: event.target.value })}
                      />
                    </label>
                  </div>
                  <label>
                    SSH user
                    <input
                      aria-label="SSH user"
                      autoComplete="off"
                      value={values.ssh.username}
                      onChange={(event) => changeSsh({ username: event.target.value })}
                    />
                  </label>
                  <label>
                    SSH private key
                    <div className="input-with-action">
                      <input
                        aria-label="SSH private key"
                        placeholder="~/.ssh/id_ed25519 — leave empty to use SSH agent"
                        value={values.ssh.keyPath}
                        onChange={(event) => changeSsh({ keyPath: event.target.value })}
                      />
                      <button
                        type="button"
                        onClick={() => postMessage?.({ type: "connection/sshKey" })}
                      >
                        Choose key…
                      </button>
                    </div>
                  </label>
                  <small>
                    Paths and SSH agent refer to the VS Code extension host. Private keys and
                    passphrases are not saved in the connection. A new server fingerprint requires
                    confirmation; changed keys are rejected.
                  </small>
                </>
              )}
            </section>
          )}
          {
            <>
              <label className="check-label">
                <input
                  aria-label={
                    local || ["mongodb", "redis"].includes(values.driver)
                      ? "Read-only connection"
                      : "Disable grid editing"
                  }
                  type="checkbox"
                  checked={values.readOnly}
                  onChange={(event) => change("readOnly", event.target.checked)}
                />
                {local || ["mongodb", "redis"].includes(values.driver)
                  ? "Read-only connection"
                  : "Disable grid editing"}
              </label>
              {!local && !noSql && (
                <small>
                  Editor SQL always uses your database account permissions. Use a read-only database
                  account to prohibit all writes.
                </small>
              )}
            </>
          }
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {status && <output>{status}</output>}
          <footer>
            {!local && (
              <button type="button" onClick={() => submit(true)}>
                Test Connection
              </button>
            )}
            <button type="submit" className="primary">
              {busy ? "Working…" : "Connect"}
            </button>
          </footer>
        </fieldset>
      </form>
    </main>
  );
}
