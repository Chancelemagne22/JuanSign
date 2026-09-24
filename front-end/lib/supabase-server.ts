import { createClient } from '@supabase/supabase-js'

// Admin client — server-side only, NEVER import in client components.
//
// Supabase is deprecating legacy `service_role` keys in favor of modern Secret
// keys (`sb_secret_...`). Both work identically here (bypass RLS). Prefer the
// new key when present, fall back to the legacy one during migration.
function resolveServiceKey(): string {
  const secret = process.env.SUPABASE_SECRET_KEY
  if (secret) return secret
  const legacy = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (legacy) return legacy
  throw new Error(
    'Missing Supabase secret: set SUPABASE_SECRET_KEY (preferred, sb_secret_...) ' +
      'or SUPABASE_SERVICE_ROLE_KEY (legacy) in .env.local'
  )
}

export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  resolveServiceKey()
)
