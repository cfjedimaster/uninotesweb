import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const rootDir = dirname(fileURLToPath(import.meta.url))

function cleanRouteMiddleware(server) {
  server.middlewares.use((req, _res, next) => {
    if (!req.url) return next()
    const [pathname, query] = req.url.split('?')
    if (pathname === '/login' || pathname === '/login/') {
      req.url = `/login/index.html${query ? `?${query}` : ''}`
    } else if (pathname === '/notes' || pathname === '/notes/') {
      req.url = `/notes/index.html${query ? `?${query}` : ''}`
    }
    next()
  })
}

export default defineConfig({
  appType: 'mpa',
  plugins: [
    {
      name: 'uninote-clean-routes',
      configureServer: cleanRouteMiddleware,
      configurePreviewServer: cleanRouteMiddleware
    }
  ],
  build: {
    rollupOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        login: resolve(rootDir, 'login/index.html'),
        notes: resolve(rootDir, 'notes/index.html')
      }
    }
  }
})
