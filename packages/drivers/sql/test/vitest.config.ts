import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    reporters: ["verbose"],
    include: ["packages/drivers/sql/test/*.integration.ts"],
    environment: "node",
    testTimeout: 120000,
    hookTimeout: 180000,
    fileParallelism: false,
  },
});
