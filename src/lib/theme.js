export const themeStorageKey = 'uninote-theme'

export function getSystemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function getStoredTheme() {
  try {
    const saved = localStorage.getItem(themeStorageKey)
    return saved === 'light' || saved === 'dark' ? saved : null
  } catch {
    return null
  }
}

export function getResolvedTheme() {
  return getStoredTheme() ?? getSystemTheme()
}

export function applyThemeState(storedOverride = getStoredTheme()) {
  const meta = document.querySelector('meta[name="color-scheme"]')
  if (meta) {
    meta.content = storedOverride ?? 'light dark'
  }
  if (storedOverride === 'light' || storedOverride === 'dark') {
    document.documentElement.dataset.theme = storedOverride
  } else {
    delete document.documentElement.dataset.theme
  }
}

export function setThemePreference(targetTheme) {
  if (targetTheme !== 'light' && targetTheme !== 'dark') return getResolvedTheme()

  const systemTheme = getSystemTheme()
  const nextStored = targetTheme === systemTheme ? null : targetTheme

  try {
    if (nextStored === null) {
      localStorage.removeItem(themeStorageKey)
    } else {
      localStorage.setItem(themeStorageKey, nextStored)
    }
  } catch {
    // Storage may be unavailable in restricted contexts; still apply to current document
  }

  applyThemeState(nextStored)
  return targetTheme
}

export function subscribeThemeChanges(onChange) {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')

  const handleMediaChange = () => {
    onChange(getResolvedTheme())
  }

  const handleStorage = (event) => {
    if (event.key !== themeStorageKey && event.key !== null) return
    applyThemeState(getStoredTheme())
    onChange(getResolvedTheme())
  }

  mediaQuery.addEventListener('change', handleMediaChange)
  window.addEventListener('storage', handleStorage)

  return () => {
    mediaQuery.removeEventListener('change', handleMediaChange)
    window.removeEventListener('storage', handleStorage)
  }
}
