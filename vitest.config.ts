import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Keep the same MSW switch visible to Node and browser-mode tests.
  envPrefix: ['VITE_', 'MSW'],
  test: {
    setupFiles: ['./test/setup.ts'],
  },
})
