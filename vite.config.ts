import { defineConfig } from "vite"

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry: {
        "wc-img-ai": "src/ai-img.ts",
        "provider-ratios": "src/provider-ratios.ts",
      },
      formats: ["es"],
    },
  },
})
