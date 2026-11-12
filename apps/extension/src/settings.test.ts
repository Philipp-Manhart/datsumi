import { expect, it, vi } from "vitest";
const values = vi.hoisted(() => ({
  globalValue: undefined as unknown,
  workspaceValue: true as unknown,
}));
vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback: unknown) => fallback,
      inspect: () => values,
    }),
  },
}));
import { userSetting } from "./settings";
it("ignores workspace overrides for sensitive retention and credential opt-ins", () => {
  expect(userSetting("drafts.recoveryEnabled", false)).toBe(false);
  values.globalValue = true;
  expect(userSetting("drafts.recoveryEnabled", false)).toBe(true);
});
