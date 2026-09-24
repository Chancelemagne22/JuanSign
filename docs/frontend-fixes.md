# JuanSign Frontend — Vulnerabilities & Inefficiencies: Issue → Solution

**Date:** 2026-09-24
**Scope:** `front-end/` only (Next.js 16 + Supabase). ML model out of scope.
**Format:** every item is Issue → Why-this-state → Solution → Verification.
**Fix order:** high-severity first (approved). Phases defined in §4.
**Status:** DOCUMENTATION ONLY — no code changed in this pass.

---

## 0. Summary Table

| ID | Title | Severity | Effort | Phase |
|---|---|---|---|---|
| V-1 | Secrets committed (`.env.local` in repo) | **Critical** | S | Phase 1 |
| V-2 | `NEXT_PUBLIC_SUPABASE_JWT_SECRET` exposed to client | High | S | Phase 1 |
| V-3 | Middleware matcher bypass (bare `/dashboard`, `/admin`) | High | S | Phase 1 |
| V-4 | Client-authoritative scores / progress / unlocks | High | M | Phase 1 (flagged) |
| V-5 | No rate-limit / payload cap (`login`, `predict`, `admin/*`, uploads) | High | M | Phase 1 |
| V-6 | Auth logic duplicated per-route; login cookie `setAll` no-op | Medium | S | Phase 2 |
| V-7 | PII + verbose server logging | Medium | S | Phase 2 |
| V-8 | `is_active` / `is_archived` not enforced outside login | Medium | S | Phase 2 |
| V-9 | Avatar upload: no type/size/authz validation on `post-signup` | Medium | S | Phase 2 |
| V-10 | Invite-code enumeration + permissive RLS/research needed | Medium | S-M | Phase 2 |
| V-11 | Missing security headers / CSP | Low-Med | S | Phase 3 |
| V-12 | `supabase` CLI as runtime dep; key-hygiene nits | Low | S | Phase 3 |
| I-1 | Admin `users`/`reports`: full-table scans + `listUsers(1000)` + O(N²) JS joins | High (perf) | M | Phase 2 |
| I-2 | Profile modal: 6-query fan-out per open | Medium | S | Phase 2 |
| I-3 | Client waterfalls / N+1 fetches | Medium | S-M | Phase 2 |
| I-4 | Middleware double DB round-trip per request | Medium | S | Phase 2 |
| I-5 | Bundle bloat (`supabase` CLI, `jspdf` eager, `ngrok` in prod) | Medium | S | Phase 3 |
| I-6 | Dead / duplicate code | Low | S | Phase 3 |
| I-7 | 76+ `console.*` noise | Low | S | Phase 3 |
| I-8 | Lessons unlock fetched then ignored | Low (product) | XS | Phase 3 |
| I-9 | Hardcoded English + asset dupes | Low | XS | Phase 3 |
| I-10 | No `typecheck`/tests, heavy `any` | Process | M | Phase 3 |

Severity = exploitability × impact (thesis deployment with trusted students, not public internet — recalibrate before public launch).

---

## 1. VULNERABILITIES

### V-1 — Secrets committed to git [Critical]

**File(s):** `front-end/.env.local` (present in tree; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_JWT_SECRET`, `MODAL_ENDPOINT_URL=https://juansign001--predict.modal.run`, `SUPABASE_SERVICE_ROLE_KEY=eyJ...`, `ADMIN_EMAIL/PASSWORD/NAME/SECRET` with `ADMIN_PASSWORD=phanini`, `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_ENV=Production`); `.gitignore` already covers `.env*` so this was force-added or never untracked.

**Issue:** anyone with repo read access gets full service-role DB bypass (RLS irrelevant), admin bootstrap creds, and the Modal endpoint. Service-role key cannot be scoped; it can read/write all tables, storage, and `auth.admin.*`. If the repo is/was pushed to GitHub, keys are compromised regardless of later deletion (history).

**Why in this state:** shared thesis machine — team committed `.env.local` so every member could `npm run dev` after `git pull` with zero secret exchange. Convenience over hygiene; common in capstone phase.

**Solution:**
1. Rotate immediately in Supabase dashboard: service-role key, admin password, invite secrets. Regenerate Modal endpoint if it enforces tokens.
2. `git rm --cached front-end/.env.local`; confirm `git status` clean; add `front-end/.env.example` with empty keys + comments (which are server-only vs `NEXT_PUBLIC_`).
3. If ever pushed remotely: purge history (`git filter-repo` / BFG) or — simpler and safer — treat all old keys as burned and rotate (recommended; history rewrite breaks teammates' clones).
4. Add pre-commit guard (e.g. `gitleaks` or simple `git diff --cached --name-only | grep env` hook) + CI check that fails if `.env.local` is tracked.

**Verification:** `git ls-files | grep env` returns only `.env.example`; `git log --all -- front-end/.env.local` shows deletion (or clean after filter-repo); app boots with fresh local `.env.local` recreated from example; old service key returns `invalid api key` when tested via `curl`.

---

### V-2 — JWT secret shipped with `NEXT_PUBLIC_` prefix [High]

**File(s):** `front-end/.env.local` (`NEXT_PUBLIC_SUPABASE_JWT_SECRET=...`).

**Issue:** everything prefixed `NEXT_PUBLIC_` is inlined into client JS at build time. A JWT secret on the client lets an attacker mint arbitrary Supabase JWTs (depending on Supabase setup) or at minimum leaks infrastructure material that aids token forgery analysis. Even if Supabase currently validates via JWKS and ignores this value client-side, the exposure is unnecessary and violates least-privilege.

**Why in this state:** copy-paste from Supabase dashboard "JWT Secret" field into the same `.env.local` block without noticing the prefix rule; no `.env.example` documented which vars must stay server-only.

**Solution:** rename to server-only `SUPABASE_JWT_SECRET` (no prefix); audit all `process.env.NEXT_PUBLIC_*` usages (`grep -rn NEXT_PUBLIC`) and keep only `URL`, `ANON_KEY`, `APP_VERSION/ENV` public; move `MODAL_ENDPOINT_URL` (already server-only — keep it that way) + `SERVICE_ROLE_KEY` + `ADMIN_*` server-only. Rebuild and confirm secret absent from `.next/static/**/*.js`.

**Verification:** `grep -r JWT_SECRET .next/static` empty; `grep -rn NEXT_PUBLIC_SUPABASE_JWT_SECRET front-end --include=*.ts --include=*.tsx` empty; app auth flows unaffected.

---

### V-3 — Middleware matcher bypass [High]

**File(s):** `front-end/middleware.ts:133-135` (`matcher: ['/admin/:path*','/dashboard/:path*','/super-admin/:path*']`); guards at `:26`, `:65`, `:106`.

**Issue:** Next `:path*` requires at least one subpath segment — bare `/dashboard` and bare `/admin` never enter middleware. `/dashboard` currently relies on client `AuthGuard` → unauthenticated flash + client-only redirect (bypassable by disabling JS / direct API calls). `/admin` has no landing at all (404 or unintended render depending on routing).

**Why in this state:** matcher semantics oversight; all internal links point to subpaths (`/dashboard/lessons`, `/admin/login`), so manual QA never hit the bare paths.

**Solution:**
```ts
export const config = { matcher: ['/admin','/admin/:path*','/dashboard','/dashboard/:path*','/super-admin/:path*'] }
```
plus explicit bare-path branches (redirect `/admin` → `/admin/login`, `/dashboard` → auth check same as `/dashboard/`). Add Playwright/curl matrix: unauthenticated `GET /dashboard`, `/dashboard/`, `/admin`, `/admin/`, `/super-admin/activity` → expect 307 to `/`, `/admin/login`, or `/dashboard` as appropriate.

**Verification:** `curl -s -o /dev/null -w '%{redirect_url}'` checks for each path with/without session cookie; no client-flash on throttled-3G load test.

---

### V-4 — Client-authoritative scores, progress, unlocks [High]

**File(s):**
- writes: `app/dashboard/practice/[chapterId]/page.tsx:196` (`practice_sessions.insert({auth_user_id:user.id, level_id:chapterId, average_accuracy:avgAccuracy})`), `app/dashboard/assessment/[chapterId]/page.tsx:52` (`assessment_results.insert({...score, stars_earned, is_passed})`), `app/dashboard/lessons/[lessonId]/page.tsx:127,142` (`user_progress` unlock-next), `lib/lessonProgress.ts:37-50` (`lessons_viewed.insert`), `components/module/AssessmentView.new.tsx:141,160`.
- policies: `juansign_database.sql:264-268` (`assessment_results FOR ALL USING (auth.uid()=auth_user_id)`), `:325-328` (`practice_sessions FOR ALL USING ...`), `:429-437` (`user_progress FOR ALL USING ...`), `:289-300` (`lessons_viewed` own-only).

**Issue:** RLS correctly scopes rows to `auth.uid()=auth_user_id`, but **values are self-asserted**. Any authenticated student can open DevTools and insert `score:100, stars_earned:3, is_passed:true`, `average_accuracy:100`, or `is_unlocked:true` for any `level_id` and unlock the whole curriculum + top leaderboards/reports. This is the highest-integrity-impact issue for an assessment platform. `avgAccuracy` in practice is computed client-side from `accuracyScores.current` (model confidences held in memory — forgeable).

**Why in this state:** correct MVP sequencing — server-side grading requires the Modal contract + question-answer key server-side, which didn't exist when practice/assessment UI was built. Client insert got the demo working; RLS gave a false sense of "secure enough" because row-ownership was enforced but value-integrity was not.

**Solution (phased, needs product sign-off):**
1. Short-term (no flow change): add `CHECK` constraints (`score 0-100`, `stars_earned 0-3`, `average_accuracy 0-100`), DB trigger capping `user_progress.is_unlocked` transitions to sequential order, and server-side anomaly log (flag jumps >1 level / perfect scores with zero `practice_sessions` latency).
2. Long-term (recommended): move grading server-side — `POST /api/assessment/submit {levelId, answers}` validates against `assessment_questions.correct_answer` (never sent to client in full), computes score/stars, inserts via `supabaseAdmin`; practice inserts via `/api/practice/submit` with Modal confidence payload re-verified. Client keeps optimistic UI but server is source of truth.
3. Never expose `correct_answer`/`correct_sign` to student clients (audit `assessment/questions/route.ts` select list — currently needed for `IdentifyView`; switch to hashed or server-checked mode).

**Verification:** as student, attempt forged `curl POST` with session JWT inserting `score:100` for locked level → expect 403/422 after fix (or trigger-capped); RLS test script (`EXPLAIN ANALYZE` + policy check) passes; admin reports show no impossible jumps on seeded data.

---

### V-5 — No rate-limit / payload caps [High]

**File(s):** `app/api/admin/login/route.ts` (password brute-force surface), `app/api/predict/route.ts:68-92` (video payloads forwarded to Modal, no size cap), `app/api/admin/*` (no throttle), `app/api/post-signup` + `profile-avatar` (multipart, no size cap).

**Issue:** unlimited login attempts → credential stuffing; unlimited `predict` → Modal cost burn (attacker loops large videos, billed to your Modal account) + DoS; unlimited avatar uploads → storage burn. Next.js default body limit applies but video base64 can still be tens of MB per request.

**Why in this state:** trusted-student thesis deployment; rate-limit infra (Upstash Redis / Supabase Vault / Vercel WAF) was never provisioned. Team prioritized getting Modal round-trip working over abuse controls.

**Solution:**
1. `login`: 5 attempts / 10 min / IP+email (in-memory LRU for single-instance; Upstash Redis for multi-instance), exponential backoff, generic error messages (already generic — keep).
2. `predict`: require auth (already), add per-user quota (e.g. 60 req/hour), `Content-Length` cap (e.g. 12 MB), request timeout + Modal timeout (e.g. 25 s), reject non-JSON early. Log quota hits.
3. Uploads: 2 MB cap, MIME allowlist (`image/jpeg/png/webp`), square-face check optional; enforce in both `post-signup` and `profile-avatar` before `storage.upload`.
4. Admin APIs: 120 req/min/IP + 5xx alerting.

**Verification:** `k6`/manual loop: 6th login in window → 429; 13 MB predict payload → 413; quota-exceeded predict → 429 with `Retry-After`; Modal spend dashboard flat under abuse test.

---

### V-6 — Duplicated auth helper; login cookie `setAll` no-op [Medium]

**File(s):** canonical `lib/adminAuth.ts:12-42` (`getAuthorizedAdmin`) vs per-route copies in `app/api/admin/users/route.ts:4-34`, `reports/route.ts:3-33`, `levels/route.ts:12-...`, `settings/route.ts`, `dashboard/route.ts`, `questions/route.ts` (each re-implements Bearer→`getUser`→`profiles.role`); `app/api/admin/login/route.ts:13-23` (`setAll` loop body empty, session returned as JSON at `:59-62`).

**Issue:** drift risk — a future fix (e.g. adding `is_archived` check) applied to one copy misses the rest; inconsistent 401 vs 403 semantics. Login not persisting HttpOnly cookies server-side forces the client to store the session (localStorage → XSS theft risk) instead of `@supabase/ssr` cookie flow.

**Why in this state:** routes were scaffolded by copy-paste from the first working admin route; login cookie code was copied from docs then neutered (empty `setAll`) when cookie persistence caused redirect loops during dev — JSON-session return was the workaround that stuck.

**Solution:** delete per-route copies, `import { getAuthorizedAdmin } from '@/lib/adminAuth'` everywhere; extend it once (role + `is_active`/`is_archived` + error codes). Fix login to use `createServerClient` cookie flow properly (set cookies on `NextResponse`, return `{success:true}` without raw session), or document why JSON-session is intentional and add XSS mitigations (short session, refresh rotation, `httpOnly` follow-up).

**Verification:** `grep -rn "async function getAuthorizedUser" app/api` returns zero; login sets `sb-*-auth-token` HttpOnly cookies in response headers; admin dashboard/users/reports still 200 with valid admin JWT, 401/403 correctly otherwise.

---

### V-7 — PII + verbose server logging [Medium]

**File(s):** `app/api/predict/route.ts:51` (`console.log Authenticated user: user` full object), `middleware.ts:66-98` (user IDs/roles per request), `app/api/admin/lessons/route.ts:35,65,82,111,211...`, `levels/page.tsx:229,245 ("niight"),834-898`, `practice/[chapterId]/page.tsx:86-89,189`, `lib/storage.ts:19,30`.

**Issue:** user IDs, emails, timing, and full auth objects in plaintext logs → log-scrape PII leak, noisy forensics, minor perf cost on hot paths (`predict` logs per frame-batch). `console.log("niight")` + lesson-form dumps suggest debug code shipped.

**Why in this state:** debug-first development against Supabase + Modal with no log-level abstraction; `console.*` was the observability stack.

**Solution:** introduce `lib/logger.ts` (`debug/info/warn/error` gated by `LOG_LEVEL`, server-only, redacts `email`, `user.id` → hash prefix, drops bodies); replace all route/page logs; keep `error` with codes (`predict_unauthorized`, `modal_non_json_502`) and strip payloads to `{status, bytes, ms}`. Delete `niight` + lesson-form dumps outright.

**Verification:** `grep -rn "console\." app lib components` returns only `logger.ts`; prod log sample contains no email/UUID; `predict` p50 unchanged or improved.

---

### V-8 — Disabled / archived accounts not enforced outside login [Medium]

**File(s):** enforcement only in `app/api/admin/login/route.ts:45-48` (`is_archived` → 403 + signOut); `middleware.ts` (`:46-56`, `:77-96`, `:115-122`) checks only `role` / `profile_id` existence; `lib/adminAuth.ts` same; `profiles` has `is_active DEFAULT true`, `is_archived DEFAULT false` (`juansign_database.sql:344,349`).

**Issue:** archiving/disabling a user blocks fresh login but existing sessions keep passing middleware + API auth (which don't check the flags) until JWT expiry/refresh. Admin "disable user" appears to work in UI but doesn't revoke promptly.

**Why in this state:** `is_active`/`is_archived` were added for the admin users table after auth was built; the flag was wired into the one place QA tested (login) and missed the session path.

**Solution:** add `is_active, is_archived` to the single `getAuthorizedAdmin` + middleware profile selects; deny when `is_active=false OR is_archived=true` (401 with `account_disabled` code, distinct from `unauthorized` for UX). Optionally revoke via `supabaseAdmin.auth.admin.signOut(userId)` on disable action in `users/route.ts` PATCH/DELETE handlers.

**Verification:** disable test student → existing session's next `/dashboard/*` + `/api/*` call 401s; re-enable → 200 again; admin disable endpoint calls `admin.signOut`.

---

### V-9 — Avatar upload validation gap (`post-signup` path) [Medium]

**File(s):** `app/api/post-signup/route.ts:8-40` (takes `userId` from **unauthenticated** form-data, no size/type cap, `ext` from filename, `upsert:true` to `avatars/${userId}.${ext}`, then updates `profiles` by `auth_user_id=userId`); contrast `app/api/profile-avatar/route.ts:4-45` (Bearer-verified, still no size/type cap).

**Issue:** `post-signup` trusts caller-supplied `userId` with no session (pre-confirmation design) → attacker can overwrite any user's avatar + `username/first_name/last_name` by guessing UUIDs, and upload arbitrary `contentType` (e.g. SVG with JS, huge TIFF) to the public `avatars` bucket. Extension from filename (`photo.name.split('.').pop()`) is spoofable; no MIME allowlist, no magic-byte check, no 2 MB cap.

**Why in this state:** email-confirmation flow leaves a window with no session, so the route was deliberately left open to complete profile setup; validation was deferred because "it's just an avatar."

**Solution:** 1) bind `userId` to a short-lived signed token (e.g. Supabase `email_confirm` proof or HMAC of `userId+expiry` with server secret) instead of raw form field; 2) enforce `photo.size <= 2MB`, `photo.type ∈ {image/jpeg,image/png,image/webp}`, verify magic bytes server-side, normalize extension from MIME (not filename), strip EXIF; 3) same caps in `profile-avatar`; 4) set bucket to non-listable + content-disposition safe. Rate-limit both routes (V-5).

**Verification:** unauthenticated forged `userId` without token → 401; oversized/SVG upload → 413/415; avatar renders as sanitized JPEG/PNG; no cross-user overwrite possible.

---

### V-10 — Invite-code enumeration + permissive update policy [Medium]

**File(s):** `app/api/admin/validate-invite/route.ts:4-62` (unauthenticated `GET ?code=`, distinct 404 vs 410 oracles, uses anon `supabase` client); `app/api/admin/setup-admin/route.ts:128-131` (`rpc handle_admin_signup`); `juansign_database.sql:230-238` (`admin_invites` permissive `UPDATE USING (true)` "via RPC" + `SELECT USING (is_used=false AND expires_at>now())`).

**Issue:** distinct `not found (404)` vs `used/expired (410)` lets attackers enumerate valid unused codes by brute force (if codes are short/human-readable — verify `generate-invite` entropy; `SETUP_ADMIN_INVITES.sql` must be checked). The `UPDATE USING (true)` policy is overly broad if any non-RPC path can write. Anon-client direct table read bypasses server-side throttling.

**Why in this state:** invite UX needed instant "code valid?" feedback on the setup page, so a public GET was the fastest path; permissive UPDATE was added to unblock the RPC during RLS debugging and never tightened.

**Solution:** 1) confirm code entropy (`generate-invite/route.ts` — require `crypto.randomBytes(16)` → 128-bit, URL-safe, never sequential); 2) collapse oracle to generic `{valid:false}` with uniform 200 + artificial delay + per-IP throttle; 3) move validation server-side via `supabaseAdmin` (not anon client); 4) tighten `UPDATE USING (true)` to RPC-only (revoke direct update or add `WITH CHECK` tied to `auth.jwt()` service path); 5) add one-time-use atomicity (`used_at` set in same RPC transaction).

**Verification:** brute-force script cannot distinguish valid/invalid faster than throttle; `SETUP_ADMIN_INVITES.sql` reviewed; direct anon `UPDATE admin_invites` denied; double-redeem race returns single winner.

---

### V-11 — Missing security headers / CSP [Low-Med]

**File(s):** `front-end/next.config.ts:1-15` (only `images.remotePatterns`).

**Issue:** no `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`. Raises XSS/clickjacking damage radius, especially combined with V-6 (client-stored session) and avatar SVG uploads (V-9).

**Why in this state:** default `create-next-app` config; headers were never a thesis requirement and break embedded-video testing if misconfigured, so left untouched.

**Solution:** add `headers()` in `next.config.ts`: `frame-ancestors 'self'`, `X-Content-Type-Options nosniff`, `Referrer-Policy strict-origin-when-cross-origin`, `Permissions-Policy (camera=(self), microphone=(), geolocation=())`, HSTS (prod only), and a tight CSP allowing `*.supabase.co` storage + Modal proxy via same-origin only (no direct `*.modal.run` in `connect-src` needed since browser uses `/api/predict`). Test practice video capture + lesson video playback under CSP.

**Verification:** `curl -I` shows headers; OWASP ZAP / `securityheaders.com` B+ minimum; no console CSP violations during practice/assessment flows.

---

### V-12 — Dependency + key hygiene nits [Low]

**File(s):** `front-end/package.json:21` (`supabase ^2.81.3` CLI as runtime dep), `:13` (`@ngrok/ngrok`), `:14-16` (`jspdf` eager).

**Issue:** `supabase` CLI (~hundreds of MB, native binaries) ships to every `npm ci` + prod image for zero runtime benefit; `ngrok` tunnel helper in prod deps widens supply-chain surface; `jspdf` eager import slows admin bundle. Separately, `ADMIN_*` + `SUPABASE_SERVICE_ROLE_KEY` share one `.env.local` with no rotation notes.

**Why in this state:** `npm i supabase` / `npm i @ngrok/ngrok` were run to unblock local dev and never pruned; `jspdf` was imported at page top for speed of implementation.

**Solution:** move `supabase` to `devDependencies` (or remove — use `npx supabase`), move `@ngrok/ngrok` to dev, `dynamic import('jspdf')` inside the export handler. Document key rotation runbook in `.env.example` header.

**Verification:** `npm ls supabase`, `next build` output size drops; `depcheck`/`npm audit` clean; admin PDF export still works via lazy chunk.

---

## 2. INEFFICIENCIES

### I-1 — Admin `users` / `reports`: full-table scans + `listUsers(1000)` + O(N²) JS joins [High perf]

**File(s):** `app/api/admin/users/route.ts:60-86` (6-way `Promise.all`: `listUsers(1000)` + full `profiles`/`user_progress`/`levels`/`practice_sessions`/`assessment_results`), `:90-130` (per-profile `.find/.filter` over full arrays); `app/api/admin/reports/route.ts:142-174` (same pattern + unbounded `assessment_results` order-desc).

**Issue:** every admin page load pulls entire tables + 1000 auth users into server memory, then joins in JS quadratically. At ~1k students this is seconds of latency + GB-scale egress; beyond 1000 users `listUsers` silently truncates (pagination ignored). No `LIMIT`, no search pushdown, no indexes beyond PK/FK (`juansign_database.sql` has only `idx_*_user/level` basics).

**Why in this state:** correct for seed data (<50 test accounts) — one `Promise.all` was faster to write than paginated SQL/views, and admin pages are low-traffic (thesis panel only).

**Solution:**
1. Paginate server-side (`page/limit/search/status/level` params; `range()` + `count:exact`), push filters into Supabase (`ilike username`, `eq level_id`, `gte attempt_date`).
2. Replace JS joins with DB views/RPC (`admin_users_overview`, `report_aggregates`) using `JOIN` + window functions; index `(auth_user_id, session_date)`, `(auth_user_id, attempt_date)`, `(level_id)`.
3. Page `listUsers` (`page` cursor) or — better — stop calling it per request: cache `email` map (5-min TTL) or store `email` denormalized on `profiles` at signup.
4. Virtualize admin tables client-side (or server-render pages).

**Verification:** with 5k seeded rows: p95 `GET /api/admin/users` < 600 ms, transferred rows ≤ page size (check Supabase query log); no truncation at 1001st user; `EXPLAIN` uses new indexes.

---

### I-2 — Profile modal 6-query fan-out [Medium]

**File(s):** `lib/lessonProgress.ts:164-172` (`levels`, `user_progress`, `practice_sessions`, `assessment_results`, `practice_questions`, `assessment_questions` in one `Promise.all`), called on every `UserProfileModal` open; `getOverallStars:223-232` adds 2 more.

**Issue:** 6–8 round-trips to compute two numbers (completion %, stars). `practice_questions`/`assessment_questions` full level-lists are fetched just for `new Set(level_id).size` denominators — static per deploy, yet re-queried per user per open.

**Why in this state:** each data source was added incrementally as profile stats grew; `Promise.all` masked the N-query smell during dev.

**Solution:** single RPC `get_user_stats(auth_user_id)` returning `{completion_rate, stars, per_level...}` (SQL counts + best-stars logic already in `:178-257` moved server-side); cache denominators (question level counts) in memory/ISR for 10 min. Client calls one endpoint.

**Verification:** DevTools Network: modal open → 1 request; identical numbers vs old implementation on fixture user; p95 < 300 ms.

---

### I-3 — Client waterfalls / N+1 [Medium]

**File(s):** `app/dashboard/lessons/page.tsx:102-105` (levels + progress parallel — good — but then per-lesson detail pages refetch serially), `components/login/LoginModal.tsx:84-85` (profile + progress parallel — good — but followed by sequential navigations), `lessons/[lessonId]/page.tsx:59,127,142` (progress reads/writes interleaved with render), `ActivityFeed.tsx:27,44,52` (3 serial queries).

**Issue:** chains of `await` where the next query doesn't depend on the previous; plus `AuthGuard` → page → component triple-fetching the same profile. Adds 200–600 ms per navigation on PH mobile networks.

**Why in this state:** feature-by-feature growth; each component fetches its own data to stay self-contained (understandable without a global store).

**Solution:** hoist session+profile+progress into `dashboard/layout.tsx` context (fetch once, pass down); convert independent awaits to `Promise.all`; make `ActivityFeed` one RPC; add `stale-while-revalidate` client cache for levels/questions (they change rarely).

**Verification:** navigation waterfall in DevTools shows ≤2 parallel batches; LCP/TBT improve on 4G-throttled test; no duplicate `profiles` request per page.

---

### I-4 — Middleware double DB round-trip per request [Medium]

**File(s):** `middleware.ts:40-51` (`getUser` + `profiles.role`), `:78-82`, `:115-119` — runs on **every** matched request including static-adjacent navigations.

**Issue:** 2 sequential Supabase round-trips on the critical path of every dashboard/admin navigation; `getUser()` already validates JWT, second query adds 50–150 ms. Verbose logs compound it.

**Why in this state:** correctness-first — explicit DB role check per request avoids stale-cookie privilege escalation; caching was deemed risky pre-defense.

**Solution:** cache `{role, is_active, is_archived}` in a short-lived signed cookie (5 min) + refresh on role-change admin action; or Edge-safe JWT claim (`app_metadata.role`) synced at login/role-change, with DB as fallback. Keep DB check for `super-admin/*` (highest privilege). Measure before/after TTFB.

**Verification:** middleware p50 drops; role-revocation test propagates ≤5 min (document SLA); `super-admin` still DB-checked.

---

### I-5 — Bundle bloat [Medium]

**File(s):** `package.json` (`supabase` CLI runtime, `@ngrok/ngrok` runtime, `jspdf` + `jspdf-autotable` eager in `reports/page.tsx`).

**Issue:** larger `node_modules` (slow CI/install), larger admin JS (slow on low-end student devices the project explicitly targets), wider supply chain.

**Why in this state:** install-what-unblocks-you dev loop; `jspdf` top-level import was the docs example.

**Solution:** `npm rm supabase @ngrok/ngrok -S; npm i -D supabase @ngrok/ngrok` (or drop `supabase` entirely), `const { jsPDF } = await import('jspdf')` inside export handler + `await import('jspdf-autotable')`. Audit with `@next/bundle-analyzer`.

**Verification:** `next build` client JS for `/admin/reports` shrinks (record before/after kB); `npm ci` time drops; export-to-PDF e2e passes.

---

### I-6 — Dead / duplicate code [Low]

**File(s):** `app/api/admin/generateinvite.ts` (87 lines, never routed — live is `generate-invite/route.ts`), `app/api/admin/setup/create-user.ts` (never routed), `components/module/AssessmentView.new.tsx` (orphan fork), `app/reorganize.bat` (hardcoded `C:\Users\Lenovo©\Desktop\...`), `components/AdminInviteForm.tsx` vs `admin/InviteGenerator.tsx` (overlap).

**Why in this state:** no cleanup pass between sprints; forks kept as "just in case" during refactor; `.bat` was a personal organizer script accidentally committed.

**Solution:** delete the 4 dead files (verify zero imports via `grep -rn`), choose one invite form (recommend `InviteGenerator.tsx` — already wired to admin flow) and delete/merge the other. One PR, pure deletion + import fix.

**Verification:** `grep` for basenames returns nothing; `tsc --noEmit`, `eslint`, `next build` green; admin invite flow e2e passes.

---

### I-7 — Log noise [Low]

**File(s):** 76 `console.*` in `app/` (full list in audit §5 of status report), plus `lib/storage.ts`, `lib/lessonProgress.ts`, `middleware.ts`.

**Why in this state:** `console` was the debugger (see V-7). Zero-cost to write, real cost to keep.

**Solution:** same `lib/logger.ts` as V-7; delete debug dumps (`niight`, lesson-form payloads, shuffle-order logs); keep `warn/error` with codes. ESLint `no-console` with allowlist for logger only.

**Verification:** `eslint` with `no-console` passes; prod log volume drops >80%.

---

### I-8 — Lessons unlock fetched then ignored [Low code / product decision]

**File(s):** `app/dashboard/lessons/page.tsx:107-117` (`unlockedIds` built, then `isUnlocked:true` hardcoded).

**Why in this state:** **intentional** — unlocked-all mode for defense/tester navigation (no grinding prerequisites during evaluation). UI (`LockIcon`, disabled state) already built for enforcement.

**Solution (one line + policy):** `isUnlocked: i===0 || unlockedIds.has(lvl.level_id)`; decide first-level bootstrap (trigger `unlock_first_level()` already exists on profile insert — confirm it covers all testers). Keep an env-gated override (`ALLOW_ALL_UNLOCKED=true` for demos) rather than hardcoded true.

**Verification:** fresh student sees only Chapter 1 open; completing lesson N unlocks N+1 (e2e); demo override documented.

---

### I-9 — Hardcoded English + asset dupes [Low]

**File(s):** literals (`Assessment Complete!`, `Excellent!`, `Close matches`, `Predicted:`, `Checking session...`), `public/menu_background.svg` + `styles/menu_background.svg` dupe, `public/images/backgrounds/.gitkeep` empty.

**Why in this state:** strings added after last i18n pass; parity script checks keys, not JSX literals. Asset dupe from CSS-vs-Next-static confusion.

**Solution:** move literals into `translations.ts` en+tl + `i18n:check`; delete `styles/menu_background.svg` (keep `public/`); add asset checklist to content pipeline.

**Verification:** `i18n:check` passes; `grep -rn "Excellent!" app components` empty; no 404s for backgrounds.

---

### I-10 — No typecheck / tests, heavy `any` [Process debt]

**File(s):** `package.json` scripts (no `typecheck`/`test`), admin pages (`(l:any)`, `data.lesson ? ...`), no `*.test.*` / e2e.

**Why in this state:** explicitly descoped — manual QA + `next build` was the quality gate for thesis timeline.

**Solution:** add `"typecheck": "tsc --noEmit"`, fix `any` incrementally (start with API routes: define `AdminUser`, `ReportData` already exist — reuse), add vitest unit (unlock logic, scoring) + Playwright smoke (login → lessons → practice mock-predict → assessment submit). Gate PRs on all three + `lint` + `i18n:check`.

**Verification:** `npm run typecheck && lint && test && i18n:check` green in CI; coverage on scoring/unlock paths.

---

## 3. Out-of-Scope / Deliberately Accepted (documented, not fixed now)

- `super-admin/activity` thinness (single invite form) — scoped out; tracked in frontend status report §3.4.
- `AssessmentView` scoring TODO (`assessment/[chapterId]/page.tsx:7`) — subsumed by V-4 server-grading work.
- `getLessonVideoUrl()` `.mp4`-only assumption — content pipeline standardizes on mp4; revisit if multi-codec needed.
- Legacy `juansignsrc/` ML drift — covered in `docs/ml-model-status-report.md`, not here.

---

## 4. Fix Roadmap (high-severity first)

- [x] **Phase 1 (Critical/High sec) — DONE 2026-09-24:** V-1 (`.env.local` verified untracked via `git ls-files`; added `front-end/.env.example`; key rotation still requires Supabase dashboard action), V-2 (removed `NEXT_PUBLIC_SUPABASE_JWT_SECRET` from `.env.local`; nothing in code read it), V-3 (matcher now covers bare `/admin|/dashboard|/super-admin` + early redirects), V-5 minimal (`lib/rateLimit.ts` + login 5/10min + predict 120 IP/60 user per hour + 12 MB cap + 25 s Modal timeout + avatar 2 MB jpeg/png/webp caps), V-4 short-term (`supabase/ADD_SCORE_CONSTRAINTS.sql`: score/confidence/best_score CHECKs + `suspicious_results` view; server-grading design still pending approval).
- [x] **Supabase new-key migration (2026-09-24):** code accepts modern Secret keys (`sb_secret_...`) via `SUPABASE_SECRET_KEY`, with legacy `SUPABASE_SERVICE_ROLE_KEY` as fallback. Changed: `lib/supabase-server.ts` (central resolver + clear missing-key error), `app/api/post-signup/route.ts`, `app/api/profile-avatar/route.ts`, `app/api/admin/lessons/route.ts` (same fallback), `front-end/.env.example` (documents preferred var). `tsc --noEmit` clean.
- [ ] **Phase 1 leftover (needs you):** create a new Secret key (Project Settings → API Keys → Create new API keys), put it in `.env.local` as `SUPABASE_SECRET_KEY="sb_secret_..."`, revoke the legacy `service_role` key when ready, update `ADMIN_PASSWORD` in `.env.local`, run `ADD_SCORE_CONSTRAINTS.sql` in Supabase SQL Editor.
- [x] **Phase 2 — DONE 2026-09-24:**
  - V-6: deleted 6 local `getAuthorizedUser` copies (`dashboard/users/reports/stats/settings/levels` now import `getAuthorizedAdmin`); fixed `DELETE /api/admin/users` missing `await` (was unauthenticated archiving) + `PATCH` (had zero auth). `generate-invite`/`setup-admin` keep custom super_admin/public paths (documented exception).
  - V-7: new `lib/logger.ts` (LOG_LEVEL-gated, prod silences debug/info); migrated `predict` (codes, no PII/payloads), all `admin/lessons` logs; removed `niight` + LessonForm dump.
  - V-8: `getAuthorizedAdmin` + middleware (`/admin`, `/super-admin`, `/dashboard`) deny `is_active=false`/`is_archived=true` on next request. Full JWT revocation on disable is not possible via Supabase admin API without the target's token — accepted limitation, documented.
  - V-9: `POST /api/post-signup` now requires session-Bearer match when a session exists, else just-created (<15 min) account + email match; added per-IP throttle (10/hr); `SignupModal` sends email + session token.
  - V-10: `generateInviteCode` → CSPRNG 16-char (~82 bits, was 8-char Math.random); `validate-invite` → 20/hr throttle + uniform 200 `{valid}` (no 404/410 oracle, no code echo), server-side via `supabaseAdmin`; `AdminSetupContent` checks `data.valid`; removed dead `validateInviteCode` import.
  - I-1: `GET /api/admin/users` joins in linear time (Maps, same response shape — no client change); auth emails paged 100/page with early-stop (no more silent 1000-user truncation); new `supabase/ADD_PERF_INDEXES.sql` (run in SQL Editor). Full RPC + server-side pagination deferred to Phase 3 (needs admin UI rework).
- [ ] **Phase 2 leftover (needs you):** run `ADD_PERF_INDEXES.sql` in Supabase SQL Editor.
- [x] **Phase 3 — DONE 2026-09-24:**
  - V-11: `next.config.ts` security headers (nosniff, SAMEORIGIN, Referrer-Policy, Permissions-Policy camera=self, tight same-origin CSP, HSTS prod-only). Browser never calls Modal directly so no `modal.run` in CSP needed.
  - V-12/I-5: `supabase` CLI + `@ngrok/ngrok` → devDependencies (lock regenerated); `jspdf`/`jspdf-autotable` lazy-loaded in both PDF export handlers (type-only import kept for casts).
  - I-6: deleted `generateinvite.ts`, `setup/create-user.ts`, `AssessmentView.new.tsx`, `reorganize.bat`, unused `InviteGenerator.tsx` (kept `AdminInviteForm`, the wired one); deleted duplicate `styles/menu_background.svg`.
  - Gitignore fixes found en route: root `supabase/` → `/supabase/` (was swallowing `front-end/supabase/*.sql` migrations), `front-end/.gitignore` `!.env.example` (was swallowing the template). All Phase 1-3 files now committable.
  - I-8: lessons unlock enforced (`i===0 || unlockedIds.has(...)`) with `NEXT_PUBLIC_ALLOW_ALL_UNLOCKED=true` demo override (documented in `.env.example`).
  - I-9: `module.predicted`/`closeMatches`, `lessonView.back`/`next` added en+tl (parity passes); `PracticeView`, `LessonPanelView`, `AuthGuard` (now uses `common.loading`) migrated. `ActivityFeedItem` left English (unwired admin debug UI).
  - I-7: `no-console` error-gated for `app/api/**`, `lib/**`, `middleware.ts` (warn for tsx); migrated all API routes, middleware, `lessonProgress`, `storage`, `retryUtils`, `supabaseHealthCheck`, `useSessionRefresh` to `logger`; scrubbed PII logs (signup email/URL/ids, admin user dumps, middleware user ids). Remaining tsx consoles are warn-level accepted.
  - I-10: `npm run typecheck` script + `.github/workflows/ci.yml` (typecheck/i18n/build gating; lint advisory via continue-on-error — see leftover).
  - I-2: `supabase/ADD_USER_STATS_RPC.sql` (`get_user_stats`, definer + self-only guard) + client prefers RPC with multi-query fallback (safe deploy order).
- [ ] **Phase 3 leftover (needs you):** run `ADD_USER_STATS_RPC.sql` in Supabase SQL Editor.
- [ ] **Known pre-existing, NOT introduced here:** full `npm run lint` reports 22 errors (`no-explicit-any`, setState-in-effect, impure-render) in untouched pages/components; `tsc`, `i18n:check`, `build` are green. Fixing those is a separate typing/effects cleanup.
- [ ] **Deferred with rationale:** I-3 (dashboard fetch hoisting into layout context) and I-4 (middleware role cache) — both touch auth/data flow on every navigation; deferred to avoid regression risk right after the auth overhaul. Recommended next milestone, not this pass.
- [ ] **Phase 3 (hygiene):** V-11 (headers/CSP), V-12/I-5 (deps/bundle), I-6 (deletions), I-7 (no-console lint), I-8 (unlock flag), I-9 (i18n/assets), I-10 (typecheck/tests/CI).

Each fix PR must reference its V-/I- ID and update the checkbox above.
