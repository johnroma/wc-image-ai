import { defineConfig } from "vite"

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry: "src/ai-img.ts",
      formats: ["es"],
    },
  },
})
