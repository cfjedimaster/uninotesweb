import './styles/theme.css'
import './styles/login.css'
import Alpine from 'alpinejs'
import { isSupabaseConfigured, supabase } from './lib/supabase.js'
import { getResolvedTheme, setThemePreference, subscribeThemeChanges } from './lib/theme.js'

function readAuthErrorFromUrl() {
  const searchParams = new URLSearchParams(window.location.search)
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const description =
    searchParams.get('error_description') ||
    hashParams.get('error_description') ||
    searchParams.get('error') ||
    hashParams.get('error')
  return description ? description.replace(/\+/g, ' ') : ''
}

Alpine.data('loginPage', () => ({
  ready: false,
  loading: false,
  configured: isSupabaseConfigured,
  theme: getResolvedTheme(),
  errorMessage: isSupabaseConfigured
    ? readAuthErrorFromUrl()
    : 'Supabase credentials are missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.',
  setTheme(nextTheme) {
    this.theme = setThemePreference(nextTheme)
  },
  async init() {
    subscribeThemeChanges(resolved => {
      this.theme = resolved
    })

    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase.auth.getSession()
      if (data?.session) {
        window.location.replace('/notes')
        return
      }
    }

    this.ready = true
  },
  async signInWithGoogle() {
    if (!supabase || this.loading) return
    this.loading = true
    this.errorMessage = ''

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/notes`
      }
    })

    if (error) {
      console.error('Google OAuth sign-in error:', error)
      this.errorMessage = error.message || 'Unable to start Google sign-in. Please check your Supabase Google provider setup.'
      this.loading = false
    }
  }
}))

Alpine.start()
