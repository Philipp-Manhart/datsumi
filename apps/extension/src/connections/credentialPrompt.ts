import type { ConnectionProfile } from "@datsumi/core";
import * as vscode from "vscode";

import type { CredentialAnswer } from "./CredentialService";
export async function promptCredential(
  profile: ConnectionProfile,
): Promise<CredentialAnswer | undefined> {
  const token = ["libsql", "turso"].includes(profile.driverId);
  const password = await vscode.window.showInputBox({
    title: `${token ? "Authentication token" : "Password"} for ${profile.name}`,
    prompt: token
      ? "Database authentication token. Leave empty only for a server without authentication."
      : "Used only by the database connection. Leave empty if the account has no password.",
    password: true,
    ignoreFocusOut: true,
  });
  if (password === undefined) return undefined;
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "Remember for this session",
        mode: "session" as const,
        description: "Discarded when VS Code reloads; Forget also clears it",
      },
      {
        label: "Save securely",
        mode: "save" as const,
        description: "Use VS Code's operating system credential storage",
      },
      {
        label: "Ask every time",
        mode: "ask" as const,
        description: "Prompt on each new connection",
      },
    ],
    { title: "Store database credentials", ignoreFocusOut: true },
  );
  if (choice) return { password, mode: choice.mode };
  return undefined;
}
