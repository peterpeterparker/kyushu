import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  test: {
    watch: false,
  },
  define: {
    __KYU_BUILD__: JSON.stringify(mode === "debug" ? "debug" : "release"),
  },
}));
