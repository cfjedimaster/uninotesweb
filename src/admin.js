import './styles/theme.css'
import './styles/admin.css'
import Alpine from 'alpinejs'
import { getResolvedTheme, setThemePreference, subscribeThemeChanges } from './lib/theme.js'

const adminSessionKey = 'uninote-admin-pw'

Alpine.data('adminDashboard', () => ({
  ready: false,
  unlocked: false,
  loading: false,
  showPassword: false,
  password: '',
  errorMessage: '',
  theme: getResolvedTheme(),
  now: Date.now(),
  clockTimer: null,
  stats: {
    userCount: 0,
    notebookCount: 0,
    noteCount: 0,
    recentLogins: []
  },

  setTheme(nextTheme) {
    this.theme = setThemePreference(nextTheme)
  },

  async init() {
    subscribeThemeChanges(resolved => {
      this.theme = resolved
    })

    this.clockTimer = setInterval(() => {
      this.now = Date.now()
    }, 30000)

    let cachedPassword = null
    try {
      cachedPassword = sessionStorage.getItem(adminSessionKey)
    } catch {
      cachedPassword = null
    }

    if (cachedPassword) {
      this.password = cachedPassword
      await this.fetchStats(cachedPassword, { silentUnauthorized: true })
    }

    this.ready = true
    if (!this.unlocked) {
      this.$nextTick(() => this.$refs.passwordInput?.focus())
    }
  },

  async unlock() {
    if (this.loading) return
    const trimmed = this.password
    if (!trimmed) {
      this.errorMessage = 'Please enter the admin password.'
      this.$refs.passwordInput?.focus()
      return
    }
    await this.fetchStats(trimmed, { silentUnauthorized: false })
  },

  async refreshStats() {
    if (this.loading || !this.password) return
    await this.fetchStats(this.password, { silentUnauthorized: false })
  },

  lockDashboard() {
    try {
      sessionStorage.removeItem(adminSessionKey)
    } catch {
      // Ignore storage errors
    }
    this.unlocked = false
    this.password = ''
    this.showPassword = false
    this.errorMessage = ''
    this.stats = {
      userCount: 0,
      notebookCount: 0,
      noteCount: 0,
      recentLogins: []
    }
    this.$nextTick(() => this.$refs.passwordInput?.focus())
  },

  async fetchStats(passwordToUse, { silentUnauthorized }) {
    this.loading = true
    this.errorMessage = ''

    try {
      const response = await fetch('/api/admin-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ password: passwordToUse })
      })

      const payload = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (response.status === 401) {
          try {
            sessionStorage.removeItem(adminSessionKey)
          } catch {
            // Ignore storage errors
          }
          this.unlocked = false
          if (!silentUnauthorized) {
            this.errorMessage = payload.error || 'Incorrect admin password.'
          }
          return
        }
        throw new Error(payload.error || 'Unable to load dashboard metrics.')
      }

      this.stats = {
        userCount: Number(payload.userCount ?? 0),
        notebookCount: Number(payload.notebookCount ?? 0),
        noteCount: Number(payload.noteCount ?? 0),
        recentLogins: Array.isArray(payload.recentLogins) ? payload.recentLogins : []
      }
      this.now = Date.now()
      this.unlocked = true

      try {
        sessionStorage.setItem(adminSessionKey, passwordToUse)
      } catch {
        // Ignore storage errors
      }
    } catch (error) {
      console.error('Admin stats error:', error)
      this.errorMessage = error.message || 'Unable to load dashboard metrics.'
    } finally {
      this.loading = false
    }
  },

  initialFor(email) {
    return (email || '?').charAt(0).toUpperCase()
  },

  formatTimestamp(isoValue) {
    if (!isoValue) return '—'
    const date = new Date(isoValue)
    if (Number.isNaN(date.getTime())) return '—'
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date)
  },

  formatRelative(isoValue) {
    if (!isoValue) return '—'
    const date = new Date(isoValue)
    if (Number.isNaN(date.getTime())) return '—'
    const diffSeconds = Math.max(0, Math.floor((this.now - date.getTime()) / 1000))
    if (diffSeconds < 60) return 'Just now'
    const diffMinutes = Math.floor(diffSeconds / 60)
    if (diffMinutes < 60) return `${diffMinutes}m ago`
    const diffHours = Math.floor(diffMinutes / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    return `${diffDays}d ago`
  }
}))

Alpine.start()
