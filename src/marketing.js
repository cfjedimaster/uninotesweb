import './styles/theme.css'
import './styles/marketing.css'
import Alpine from 'alpinejs'
import { isSupabaseConfigured, supabase } from './lib/supabase.js'
import { getResolvedTheme, setThemePreference, subscribeThemeChanges } from './lib/theme.js'

Alpine.data('marketingPage', () => ({
  ready: false,
  theme: getResolvedTheme(),
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
  }
}))

Alpine.start()
