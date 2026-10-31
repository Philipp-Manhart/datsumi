import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";

import { ConnectionForm } from "./ConnectionForm";
afterEach(cleanup);
describe("single connection form", () => {
  it("keeps URLs visible and splits pasted credentials into their own fields", () => {
    const post = vi.fn<(message: unknown) => void>();
    render(<ConnectionForm postMessage={post} />);
    fireEvent.change(screen.getByLabelText("Database type"), { target: { value: "mongodb" } });
    fireEvent.click(screen.getByRole("button", { name: "Connection URL" }));
    const url = screen.getByLabelText("Connection URL");
    fireEvent.change(url, {
      target: {
        value: "mongodb://demo:secret%21@localhost:27017/playground?authSource=admin&tls=false",
      },
    });
    expect(url).toHaveAttribute("type", "text");
    expect(url).toHaveValue("mongodb://localhost:27017/playground?authSource=admin&tls=false");
    expect(screen.getByLabelText("Username")).toHaveValue("demo");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("Password")).toHaveValue("secret!");
    fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "connection/submit",
        test: true,
        values: expect.objectContaining({
          username: "demo",
          password: "secret!",
          url: expect.not.stringContaining("secret"),
        }),
      }),
    );
    void act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "connection/state", busy: false, error: "Authentication failed" },
        }),
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Authentication failed");
    expect(screen.getByLabelText("Password")).toHaveValue("secret!");
  });
  it("opens file selection from the same form and validates missing paths", () => {
    const post = vi.fn<(message: unknown) => void>();
    render(<ConnectionForm postMessage={post} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a database file");
    fireEvent.change(screen.getByLabelText("Database type"), { target: { value: "duckdb" } });
    fireEvent.change(screen.getByLabelText("Database file mode"), { target: { value: "create" } });
    fireEvent.click(screen.getByRole("button", { name: "Browse…" }));
    expect(post).toHaveBeenLastCalledWith({
      type: "connection/browse",
      driver: "duckdb",
      create: true,
    });
    void act(() =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "connection/state", path: "/tmp/new.duckdb" },
        }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "connection/submit",
        test: false,
        values: expect.objectContaining({
          driver: "duckdb",
          path: "/tmp/new.duckdb",
          create: true,
        }),
      }),
    );
  });
});

it("offers PostgreSQL cloud presets and separate ClickHouse and Oracle connections", () => {
  const post = vi.fn<(message: unknown) => void>();
  render(<ConnectionForm postMessage={post} />);
  const engine = screen.getByLabelText("Database type");
  fireEvent.change(engine, { target: { value: "postgres" } });
  fireEvent.change(screen.getByLabelText("Connection preset"), { target: { value: "neon" } });
  expect(screen.getByLabelText("Connection name")).toHaveValue("Neon");
  const url = screen.getByLabelText("Connection URL");
  fireEvent.change(url, {
    target: {
      value:
        "postgresql://owner:secret@ep-test.neon.tech/neondb?sslmode=require&channel_binding=require",
    },
  });
  expect(screen.getByLabelText("Password")).toHaveValue("secret");
  expect(url).toHaveValue(
    "postgresql://ep-test.neon.tech/neondb?sslmode=require&channel_binding=require",
  );
  fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
  expect(post).toHaveBeenLastCalledWith(
    expect.objectContaining({
      values: expect.objectContaining({
        provider: "neon",
        driver: "postgres",
        tls: true,
        username: "owner",
      }),
    }),
  );
  cleanup();
  render(<ConnectionForm postMessage={post} />);
  fireEvent.change(screen.getByLabelText("Database type"), { target: { value: "clickhouse" } });
  expect(screen.getByLabelText("Port")).toHaveValue("8443");
  expect(screen.getByLabelText("Database")).toHaveValue("default");
  fireEvent.change(screen.getByLabelText("Database type"), { target: { value: "oracle" } });
  expect(screen.getByText("Service name")).toBeVisible();
  expect(screen.getByLabelText("Database")).toHaveValue("FREEPDB1");
});

it("keeps SSH identity separate from the database login and submits tunnel settings", () => {
  const post = vi.fn<(message: unknown) => void>();
  render(<ConnectionForm postMessage={post} />);
  expect(screen.queryByLabelText("Connect via SSH")).toBeNull();
  fireEvent.change(screen.getByLabelText("Database type"), { target: { value: "postgres" } });
  fireEvent.click(screen.getByLabelText("Connect via SSH"));
  fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
  expect(screen.getByRole("alert")).toHaveTextContent("SSH host");
  fireEvent.change(screen.getByLabelText("SSH host"), { target: { value: "vps.example" } });
  fireEvent.change(screen.getByLabelText("SSH user"), { target: { value: "ssh-user" } });
  fireEvent.change(screen.getByLabelText("SSH private key"), {
    target: { value: "~/.ssh/id_ed25519" },
  });
  fireEvent.change(screen.getByLabelText("Host"), { target: { value: "127.0.0.1" } });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "db-user" } });
  fireEvent.click(screen.getByRole("button", { name: "Test Connection" }));
  expect(post).toHaveBeenLastCalledWith(
    expect.objectContaining({
      values: expect.objectContaining({
        host: "127.0.0.1",
        username: "db-user",
        ssh: {
          enabled: true,
          host: "vps.example",
          port: "22",
          username: "ssh-user",
          keyPath: "~/.ssh/id_ed25519",
        },
      }),
    }),
  );
});

it.each(["libsql", "turso"])("offers a URL and separate secure token for %s", (driver) => {
  const post = vi.fn<(message: unknown) => void>();
  render(<ConnectionForm postMessage={post} />);
  fireEvent.change(screen.getByLabelText("Database type"), { target: { value: driver } });
  expect(screen.queryByLabelText("Username")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Connect via SSH")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Connection fields" })).not.toBeInTheDocument();
  const url = screen.getByLabelText("Connection URL");
  fireEvent.change(url, { target: { value: "libsql://demo.turso.io" } });
  expect(url).toHaveAttribute("type", "text");
  const token = screen.getByLabelText("Authentication token");
  expect(token).toHaveAttribute("type", "password");
  fireEvent.change(token, { target: { value: "test-token" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  expect(post).toHaveBeenLastCalledWith(
    expect.objectContaining({
      type: "connection/submit",
      values: expect.objectContaining({
        driver,
        url: "libsql://demo.turso.io",
        password: "test-token",
      }),
    }),
  );
});
