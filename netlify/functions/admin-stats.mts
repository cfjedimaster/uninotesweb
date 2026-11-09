import { createHash, timingSafeEqual } from "node:crypto"

function safeEqualStrings(first: string, second: string): boolean {
  const firstDigest = createHash("sha256").update(first).digest()
  const secondDigest = createHash("sha256").update(second).digest()
  return timingSafeEqual(firstDigest, secondDigest)
}

export default async (req: Request) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store"
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers
    })
  }

  const expectedPassword = Netlify.env.get("ADMIN_PASSWORD")
  const adminStatsToken = Netlify.env.get("ADMIN_STATS_TOKEN")
  const supabaseUrl = Netlify.env.get("VITE_SUPABASE_URL")
  const supabaseKey =
    Netlify.env.get("VITE_SUPABASE_PUBLISHABLE_KEY") ||
    Netlify.env.get("VITE_SUPABASE_ANON_KEY")

  if (!expectedPassword || !adminStatsToken || !supabaseUrl || !supabaseKey) {
    return new Response(
      JSON.stringify({ error: "Admin environment is not configured on the server." }),
      { status: 500, headers }
    )
  }

  let body: { password?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request payload." }), {
      status: 400,
      headers
    })
  }

  const submittedPassword = typeof body?.password === "string" ? body.password : ""
  if (!submittedPassword || !safeEqualStrings(submittedPassword, expectedPassword)) {
    return new Response(JSON.stringify({ error: "Incorrect admin password." }), {
      status: 401,
      headers
    })
  }

  const rpcResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/get_admin_stats`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`
    },
    body: JSON.stringify({ admin_token: adminStatsToken })
  })

  if (!rpcResponse.ok) {
    return new Response(
      JSON.stringify({ error: "Unable to load dashboard metrics." }),
      { status: 502, headers }
    )
  }

  const stats = await rpcResponse.json()
  return new Response(JSON.stringify(stats), {
    status: 200,
    headers
  })
}

export const config = {
  path: "/api/admin-stats"
}
