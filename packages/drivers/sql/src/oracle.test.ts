/* oxlint-disable typescript/no-unsafe-type-assertion -- This test supplies a minimal connection fake to inspect transport options without a TCPS server. */
import oracledb from "oracledb";
import { afterEach, describe, expect, it, vi } from "vitest";

import { connect } from "./oracle";

const config = {
  host: "db.example",
  port: 1522,
  database: "service.example",
  username: "app",
  password: "private",
  tls: "verify" as const,
  ca: "certificate-only-fixture",
  readOnly: false,
};
afterEach(() => vi.restoreAllMocks());
function fixture() {
  const execute = vi.fn<() => Promise<oracledb.Result<unknown>>>().mockResolvedValue({});
  const close = vi.fn<() => Promise<void>>().mockResolvedValue();
  const connection = { execute, close, callTimeout: 0 };
  const open = vi
    .spyOn(oracledb, "getConnection")
    .mockImplementation(async () => connection as unknown as oracledb.Connection);
  return { execute, close, connection, open };
}
describe("Oracle transport security", () => {
  it("uses Thin mode and verified TCPS with an explicit CA and hostname matching", async () => {
    const { open, close } = fixture();
    const backend = await connect(config);
    expect(oracledb.thin).toBe(true);
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({
        sslServerDNMatch: true,
        sslAllowWeakDNMatch: false,
        walletContent: config.ca,
        user: "app",
        password: "private",
        connectString: expect.stringContaining("(PROTOCOL=TCPS)"),
      }),
    );
    await backend.close();
    expect(close).toHaveBeenCalledOnce();
  });
  it("does not interpolate injected Oracle Net options", async () => {
    const { open } = fixture();
    await expect(
      connect({ ...config, database: "service)(SECURITY=(SSL_SERVER_DN_MATCH=OFF))" }),
    ).rejects.toThrow("Invalid Oracle");
    await expect(connect({ ...config, host: "db)(PORT=1521)" })).rejects.toThrow("Invalid Oracle");
    expect(open).not.toHaveBeenCalled();
  });
  it("closes the connection if session initialization fails", async () => {
    const { execute, close } = fixture();
    execute.mockRejectedValueOnce(new Error("initialization failed"));
    await expect(connect(config)).rejects.toThrow("initialization failed");
    expect(close).toHaveBeenCalledOnce();
  });
});

it("keeps the Oracle TLS hostname while routing through a loopback CONNECT proxy", async () => {
  const { open } = fixture();
  const backend = await connect({ ...config, tunnelPort: 45000 });
  expect(open).toHaveBeenCalledWith(
    expect.objectContaining({
      httpsProxy: "127.0.0.1",
      httpsProxyPort: 45000,
      sslServerDNMatch: true,
      sslAllowWeakDNMatch: false,
      connectString: expect.stringContaining("(HOST=db.example)(PORT=1522)"),
    }),
  );
  await backend.close();
});
