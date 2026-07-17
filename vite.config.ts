import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  // One test-only MSW switch is shared by Node (`process.env.MSW`) and
  // browser code (`import.meta.env.MSW`). Do not put secrets in this variable.
  envPrefix: ['VITE_', 'MSW'],
  build: {
    minify: false,
    lib: {
      entry: {
        'wc-img-ai': 'src/ai-img.ts',
        'provider-ratios': 'src/provider-ratios.ts',
        server: 'src/server.ts',
      },
      formats: ['es'],
    },
  },
})
