import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: { environment: "jsdom" },
  resolve: { alias: {
    "@/": path.resolve(here, "src") + "/",
    "@cooket/contracts-sdk": path.resolve(here, "../../packages/contracts-sdk/src/index.ts"),
    "@cooket/types": path.resolve(here, "../../packages/types/src/index.ts"),
  } },
});
