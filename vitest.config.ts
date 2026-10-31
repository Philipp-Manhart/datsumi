import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          environment: "node",
          include: ["packages/**/src/**/*.test.ts"],
          name: "shared",
        },
      },
      {
        test: {
          environment: "node",
          include: ["apps/extension/src/**/*.test.ts"],
          name: "extension",
        },
      },
      {
        test: {
          environment: "jsdom",
          include: ["apps/webview/src/**/*.test.{ts,tsx}"],
          name: "webview",
        },
      },
    ],
  },
});
