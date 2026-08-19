import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Python API runs on 8000; the dev server proxies to it so the frontend
// talks to /api in both dev and the built app.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: { outDir: 'dist' },
})
