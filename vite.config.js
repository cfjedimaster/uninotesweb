import { createHash, timingSafeEqual } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

const rootDir = dirname(fileURLToPath(import.meta.url))

function safeEqualStrings(first, second) {
  const firstDigest = createHash('sha256').update(first).digest()
  const secondDigest = createHash('sha256').update(second).digest()
  return timingSafeEqual(firstDigest, secondDigest)
}

function createRouteAndAdminPlugin(env) {
  const attachCleanRoutes = (server) => {
    server.middlewares.use((req, _res, next) => {
      if (!req.url) return next()
      const [pathname, query] = req.url.split('?')
      if (pathname === '/login' || pathname === '/login/') {
        req.url = `/login/index.html${query ? `?${query}` : ''}`
      } else if (pathname === '/notes' || pathname === '/notes/') {
        req.url = `/notes/index.html${query ? `?${query}` : ''}`
      } else if (pathname === '/admin' || pathname === '/admin/') {
        req.url = `/admin/index.html${query ? `?${query}` : ''}`
      }
      next()
    })
  }

  return {
    name: 'uninote-clean-routes',
    configureServer(server) {
      server.middlewares.use('/api/admin-stats', async (req, res, next) => {
        if (process.env.NETLIFY_DEV) return next()

        res.setHeader('Content-Type', 'application/json')
        res.setHeader('Cache-Control', 'no-store')

        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed.' }))
          return
        }

        let rawBody = ''
        for await (const chunk of req) {
          rawBody += chunk
        }

        let parsed = {}
        try {
          parsed = JSON.parse(rawBody || '{}')
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'Invalid request payload.' }))
          return
        }

        const expectedPassword = env.ADMIN_PASSWORD
        const adminStatsToken = env.ADMIN_STATS_TOKEN
        const supabaseUrl = env.VITE_SUPABASE_URL
        const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY

        if (!expectedPassword || !adminStatsToken || !supabaseUrl || !supabaseKey) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Admin environment is not configured in .env.' }))
          return
        }

        const submitted = typeof parsed.password === 'string' ? parsed.password : ''
        if (!submitted || !safeEqualStrings(submitted, expectedPassword)) {
          res.statusCode = 401
          res.end(JSON.stringify({ error: 'Incorrect admin password.' }))
          return
        }

        try {
          const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_admin_stats`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              apikey: supabaseKey,
              Authorization: `Bearer ${supabaseKey}`
            },
            body: JSON.stringify({ admin_token: adminStatsToken })
          })

          const text = await rpcResponse.text()
          res.statusCode = rpcResponse.ok ? 200 : 502
          res.end(rpcResponse.ok ? text : JSON.stringify({ error: 'Unable to load dashboard metrics.' }))
        } catch {
          res.statusCode = 502
          res.end(JSON.stringify({ error: 'Unable to reach database.' }))
        }
      })

      attachCleanRoutes(server)
    },
    configurePreviewServer: attachCleanRoutes
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '')

  return {
    appType: 'mpa',
    plugins: [createRouteAndAdminPlugin(env)],
    build: {
      rollupOptions: {
        input: {
          main: resolve(rootDir, 'index.html'),
          login: resolve(rootDir, 'login/index.html'),
          notes: resolve(rootDir, 'notes/index.html'),
          admin: resolve(rootDir, 'admin/index.html')
        }
      }
    }
  }
})
