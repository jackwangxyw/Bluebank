import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Two build targets from one source tree.
 *
 *   npm run build        localhost. Talks to the Python server on :8000, so
 *                        assets are served from the root and /api is proxied
 *                        in dev.
 *   npm run build:pages  GitHub Pages. No server, so `base` has to match the
 *                        repo name or every asset 404s, and the output goes to
 *                        dist-pages so the two builds never overwrite each
 *                        other.
 *
 * Set BASE=/ when deploying Pages to a custom domain.
 */
export default defineConfig(({ mode }) => {
  const pages = mode === 'pages'
  return {
    plugins: [react()],
    base: pages ? (process.env.BASE ?? '/Bluebank/') : '/',
    server: {
      port: 5173,
      proxy: { '/api': 'http://127.0.0.1:8000' },
    },
    build: {
      outDir: pages ? 'dist-pages' : 'dist',
      // MathJax is 1.9 MB and vendored on purpose; the warning is noise.
      chunkSizeWarningLimit: 2048,
    },
  }
})
