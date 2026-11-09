# Uninote Web

Web port of the TinyJS **Uninote** desktop app, built with **Vite**, **Alpine.js v3**, **Google OAuth**, and **Supabase Postgres** (with Row Level Security).

## Routes

- **`/`** — Marketing landing page (auto-redirects to `/notes` when signed in)
- **`/login`** — Google OAuth sign-in card (auto-redirects to `/notes` when signed in)
- **`/notes`** — Uninote three-pane workspace (seeds a default `Personal` notebook on first signup and includes a sidebar **Log out** button)

---

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and fill in your Supabase project URL and publishable key:

```bash
cp .env.example .env
```

```dotenv
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

### 2. Database Schema & Row Level Security

Run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL Editor to create:

- `public.notebooks` and `public.notes` tables + indexes
- Strict `authenticated` Row Level Security (RLS) policies enforcing `auth.uid() = user_id`
- An `auth.users` signup trigger (`private.handle_new_user`) that automatically seeds a **`Personal`** notebook for every new user

### 3. Create a Google Cloud OAuth 2.0 Client ID

1. Open the [Google Auth Platform — Clients Console](https://console.cloud.google.com/auth/clients).
2. Configure the consent screen / branding if you haven't already, and ensure the `openid`, `.../auth/userinfo.email`, and `.../auth/userinfo.profile` scopes are enabled under **Data Access**.
3. Click **Create Client** and choose **Web application**.
4. Under **Authorized JavaScript origins**, add:
   - `http://localhost:5173` *(plus your production domain when deployed)*
5. Under **Authorized redirect URIs**, add your Supabase Auth callback URL:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`
6. Click **Create** and copy the **Client ID** and **Client Secret**.

### 4. Enable Google in Supabase Auth

1. Open **Supabase Dashboard → Authentication → Providers → Google**.
2. Toggle **Enable Sign in with Google** on, paste your **Client ID** and **Client Secret**, and click **Save**.
3. Open **Supabase Dashboard → Authentication → URL Configuration**:
   - Set **Site URL** to `http://localhost:5173` (or your production domain).
   - Under **Redirect URLs**, add:
     - `http://localhost:5173/notes`
     - *(Plus `https://your-production-domain.com/notes` when deploying)*

---

## Local Development

```bash
npm install
npm run dev
```

Then visit `http://localhost:5173/`.
