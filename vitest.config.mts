import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // The database-backed trading tests drive ticks that act on every agent in the database, so files run one at a time.
  test: { include: ["src/**/*.test.ts"], fileParallelism: false },
});
