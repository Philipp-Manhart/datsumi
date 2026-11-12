import { expect, it } from "vitest";

import { connectionHint } from "./connectionHints";
it("offers static safe actions without echoing server-supplied content", () => {
  expect(connectionHint("JWT expired: secret-token")).toContain("Change Database Credentials");
  expect(connectionHint("JWT expired: secret-token")).not.toContain("secret-token");
  expect(connectionHint("certificate hostname mismatch")).toContain(
    "Keep TLS verification enabled",
  );
  expect(connectionHint("host key changed")).toContain("Independently verify");
});
