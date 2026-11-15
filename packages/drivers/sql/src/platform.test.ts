import { expect, it } from "vitest";

// @ts-expect-error Test/developer-only JavaScript launcher, deliberately outside production bundles.
import { windowsCodeLaunch, vscodeCommand } from "../../../../scripts/vscode-command.mjs";
it("launches Windows VS Code through its CLI module with paths kept as separate arguments", async () => {
  const launch = windowsCodeLaunch("C:\\Users\\Demo User\\Apps\\Microsoft VS Code\\bin\\code.cmd");
  expect(launch.command).toBe("C:\\Users\\Demo User\\Apps\\Microsoft VS Code\\Code.exe");
  expect(launch.args).toEqual([
    "C:\\Users\\Demo User\\Apps\\Microsoft VS Code\\resources\\app\\out\\cli.js",
  ]);
  expect(launch.env.ELECTRON_RUN_AS_NODE).toBe("1");
  expect(
    await vscodeCommand(
      "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
      "darwin",
    ),
  ).toEqual({
    command: "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
    args: [],
    env: {},
  });
});
