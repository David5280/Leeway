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
  },
})
