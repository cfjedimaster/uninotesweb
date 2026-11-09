# Changelog

All notable changes to **Uninote Web** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [2026-11-09]

### Added
- **Mobile & tablet `/notes` experience**:
  - Responsive 3 → 2 → 1 pane workspace layout (3 panes on desktop, 2-pane split on tablets `<= 960px`, full-screen single-pane list/editor drill-down on phones `<= 700px`).
  - Swipeable slide-out notebooks & account drawer using horizontal CSS scroll-snap, scroll-driven backdrop fade (with JS fallbacks), `inert` background isolation, and `Escape` / backdrop dismissal.
  - Mobile `← Notes` back navigation in the editor toolbar, mobile empty-notebook state inside the notes panel, safe-area inset padding (`viewport-fit=cover`), dynamic viewport sizing (`dvh`/`dvw`), and coarse-pointer touch target sizing.
- **Password-protected `/admin` dashboard** (`031fa1b`):
  - Summary cards for total users, notebooks, and notes, plus a responsive table of the 10 most recent sign-in events.
  - `private.login_events` tracking trigger on `auth.sessions`, bcrypt-gated `public.get_admin_stats` database function, and `/api/admin-stats` serverless endpoint (with local Vite dev middleware support).
- **Netlify deployment configuration** (`758790c`):
  - `netlify.toml` build settings and `/api/admin-stats` function redirect.
- **Initial Uninote Web release** (`adfb949`):
  - Marketing landing page (`/`), Google sign-in page (`/login`), and three-pane notes workspace (`/notes`).
  - Notebook and note CRUD backed by Supabase Postgres with strict per-user Row Level Security (`auth.uid() = user_id`) and automatic `Personal` notebook seeding on first signup.
  - Auto-saving note editor, soft-delete undo toast, keyboard shortcuts, and persistent light/dark theme switcher.

### Changed
- **Google sign-in flow** (`4a475c7`):
  - Switched `/login` to direct Google Identity Services ID-token authentication (`signInWithIdToken` with SHA-256 nonce) with automatic fallback to OAuth redirect when needed.
- **Theme color synchronization**:
  - Updated `<meta name="theme-color">` dynamically across light and dark modes so mobile browser chrome matches the active theme.
- **Mobile input ergonomics**:
  - Increased compact/touch editor body and dialog input font sizes to `16px` to prevent iOS Safari auto-zoom on focus, and made notebook delete controls visible on touch devices without requiring hover.
