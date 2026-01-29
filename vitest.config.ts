import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60000, // 60 seconds for API calls
    hookTimeout: 30000,
    globals: true,
  },
});
