import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const server = process.env.LEEWAY_SERVER ?? 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    // In development the web app runs on Vite and talks to the API server.
    proxy: { '/api': server, '/mcp': server },
  },
  build: { outDir: 'dist', sourcemap: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // The entry point only mounts the app, fonts.ts only imports font files,
      // and test helpers are not app code.
      exclude: ['src/main.tsx', 'src/fonts.ts', 'src/test/**', 'src/**/*.test.{ts,tsx}'],
      // These only ever go up (CONTRIBUTING.md).
      // Floors at the measured coverage; raise them as tests are added, never lower them.
      thresholds: { statements: 99, branches: 96, functions: 98, lines: 99 },
    },
  },
})
