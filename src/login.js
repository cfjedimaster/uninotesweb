import './styles/theme.css'
import './styles/login.css'
import Alpine from 'alpinejs'
import { isSupabaseConfigured, supabase } from './lib/supabase.js'
import { getResolvedTheme, setThemePreference, subscribeThemeChanges } from './lib/theme.js'

const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim()
const hasGoogleClientId = Boolean(
  googleClientId && !googleClientId.includes('your-google-client-id')
)

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

async function createNoncePair() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32))
  const rawNonce = btoa(String.fromCharCode(...randomBytes))
  const digestBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(rawNonce)
  )
  const hashedNonce = Array.from(new Uint8Array(digestBuffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
  return { rawNonce, hashedNonce }
}

function waitForGoogleScript(timeoutMs = 6000) {
  if (window.google?.accounts?.id) {
    return Promise.resolve(true)
  }

  return new Promise(resolve => {
    const scriptEl = document.querySelector('script[src="https://accounts.google.com/gsi/client"]')
    const timer = setTimeout(() => {
      cleanup()
      resolve(Boolean(window.google?.accounts?.id))
    }, timeoutMs)

    const onLoad = () => {
      cleanup()
      resolve(Boolean(window.google?.accounts?.id))
    }

    const onError = () => {
      cleanup()
      resolve(false)
    }

    function cleanup() {
      clearTimeout(timer)
      scriptEl?.removeEventListener('load', onLoad)
      scriptEl?.removeEventListener('error', onError)
    }

    if (!scriptEl) {
      cleanup()
      resolve(false)
      return
    }

    scriptEl.addEventListener('load', onLoad, { once: true })
    scriptEl.addEventListener('error', onError, { once: true })
  })
}

Alpine.data('loginPage', () => ({
  ready: false,
  loading: false,
  gisReady: false,
  gisFailed: false,
  rawNonce: '',
  configured: isSupabaseConfigured,
  hasClientId: hasGoogleClientId,
  theme: getResolvedTheme(),
  errorMessage: isSupabaseConfigured
    ? readAuthErrorFromUrl()
    : 'Sign-in is not configured yet.',

  setTheme(nextTheme) {
    this.theme = setThemePreference(nextTheme)
    if (this.gisReady) {
      this.$nextTick(() => this.renderGoogleButton())
    }
  },

  async init() {
    subscribeThemeChanges(resolved => {
      this.theme = resolved
      if (this.gisReady) {
        this.$nextTick(() => this.renderGoogleButton())
      }
    })

    if (isSupabaseConfigured && supabase) {
      const { data } = await supabase.auth.getSession()
      if (data?.session) {
        window.location.replace('/notes')
        return
      }
    }

    this.ready = true

    if (isSupabaseConfigured && hasGoogleClientId) {
      const loaded = await waitForGoogleScript()
      if (!loaded) {
        this.gisFailed = true
        return
      }
      await this.setupGoogleIdentity({ triggerPrompt: true })
    }
  },

  async setupGoogleIdentity({ triggerPrompt = false } = {}) {
    if (!window.google?.accounts?.id) {
      this.gisFailed = true
      return
    }

    const { rawNonce, hashedNonce } = await createNoncePair()
    this.rawNonce = rawNonce

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: response => this.handleGoogleCredential(response),
      nonce: hashedNonce,
      auto_select: false,
      itp_support: true,
      use_fedcm_for_prompt: true
    })

    this.gisReady = true
    this.$nextTick(() => {
      this.renderGoogleButton()
      if (triggerPrompt) {
        window.google.accounts.id.prompt()
      }
    })
  },

  renderGoogleButton() {
    const slot = this.$refs.googleButtonSlot
    if (!slot || !window.google?.accounts?.id) return

    const measuredWidth = slot.parentElement?.clientWidth || 360
    const buttonWidth = Math.min(400, Math.max(220, Math.floor(measuredWidth)))

    slot.replaceChildren()
    window.google.accounts.id.renderButton(slot, {
      type: 'standard',
      shape: 'pill',
      theme: this.theme === 'dark' ? 'filled_black' : 'outline',
      text: 'continue_with',
      size: 'large',
      logo_alignment: 'left',
      width: buttonWidth
    })
  },

  async handleGoogleCredential(response) {
    if (!supabase || this.loading) return
    if (!response?.credential) {
      this.errorMessage = 'No sign-in credential was returned. Please try again.'
      return
    }

    this.loading = true
    this.errorMessage = ''

    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: response.credential,
      nonce: this.rawNonce
    })

    if (error) {
      console.error('ID token sign-in error:', error)
      this.errorMessage = error.message || 'Unable to complete sign-in. Please try again.'
      this.loading = false
      await this.setupGoogleIdentity({ triggerPrompt: false })
      return
    }

    window.location.replace('/notes')
  },

  async signInWithOAuthFallback() {
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
      console.error('OAuth sign-in error:', error)
      this.errorMessage = error.message || 'Unable to start sign-in. Please try again.'
      this.loading = false
    }
  }
}))

Alpine.start()
