import { access } from "node:fs/promises";
import { win32 } from "node:path";

/** Resolve Windows' code.cmd without invoking a shell or interpolating fixture paths. */
export function windowsCodeLaunch(executable) {
  const root = /\.cmd$/i.test(executable)
    ? win32.dirname(win32.dirname(executable))
    : win32.dirname(executable);
  return {
    command: win32.join(root, "Code.exe"),
    args: [win32.join(root, "resources", "app", "out", "cli.js")],
    env: { ELECTRON_RUN_AS_NODE: "1" },
  };
}
export async function vscodeCommand(
  executable = process.env.VSCODE_EXECUTABLE || "code",
  platform = process.platform,
) {
  if (platform !== "win32") return { command: executable, args: [], env: {} };
  const candidates =
    executable === "code" || executable === "code.cmd"
      ? [
          ...(process.env.LOCALAPPDATA
            ? [win32.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe")]
            : []),
          ...[process.env.ProgramW6432, process.env.ProgramFiles]
            .filter(Boolean)
            .map((path) => win32.join(path, "Microsoft VS Code", "Code.exe")),
        ]
      : [executable];
  for (const candidate of candidates) {
    const result = windowsCodeLaunch(candidate);
    try {
      await access(result.command);
      await access(result.args[0]);
      return result;
    } catch {
      /* Try the next standard installation. */
    }
  }
  throw new Error(
    "Set VSCODE_EXECUTABLE to Code.exe or the full bin/code.cmd path of a standard VS Code installation.",
  );
}
