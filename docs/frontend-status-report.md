# JuanSign Frontend — Technical Status Report

**Date:** 2026-09-24
**Root:** `front-end/`
**Stack:** Next.js `16.1.6` (App Router) + React `19.2.3` + TypeScript `5` + Tailwind CSS `4` (`@tailwindcss/postcss`) + Supabase (`@supabase/ssr ^0.9.0`, `@supabase/supabase-js ^2.98.0`)
**Version:** `front-end@0.2.0` (private)
**Report scope:** read-only audit of current working tree. No code changes made for this report.

---

## 1. Architecture Overview

```
front-end/
  app/                  # App Router: pages + layouts + API routes
    page.tsx            # GET / (welcome)
    layout.tsx
    auth/confirm/route.ts
    reset-password/  reactivate/  verify-email-wait/
    dashboard/          # student area (AuthGuard + layout)
      page.tsx          # hub
      lessons/page.tsx + lessons/[lessonId]/page.tsx
      practice/page.tsx + practice/[chapterId]/page.tsx
      assessment/page.tsx + assessment/[chapterId]/page.tsx
    admin/
      setup/page.tsx
      (auth)/login/page.tsx
      (protected)/page.tsx + users/ levels/ settings/ archive/ reports/
    super-admin/page.tsx + super-admin/activity/page.tsx
    api/
      predict/route.ts  profile-avatar/route.ts  post-signup/route.ts
      assessment/questions/route.ts
      admin/{login,logout,validate-invite,stats,dashboard,users,levels,
            levels-list,lessons,questions,reports,settings,
            generate-invite,setup-admin}/route.ts
      admin/generateinvite.ts (DEAD)  admin/setup/create-user.ts (DEAD)
    reorganize.bat (STRAY, delete)
  components/ (~35)     # welcome, signup, login, profile, settings, module/*, lessons/*, admin/*
  lib/ (11)             # supabase.ts, supabase-server.ts, supabaseHealthCheck.ts,
                        # adminAuth.ts, adminFetch.ts, adminInvites.ts,
                        # adminInvites.client.ts, lessonProgress.ts, storage.ts,
                        # retryUtils.ts, useSessionRefresh.ts
  hooks/                # useSettings.ts, useLanguage.ts (shim), useVideoList.ts
  context/              # LanguageContext.tsx (real implementation)
  types/                # user.ts (UserData only)
  i18n/                 # translations.ts (en + tl, 614 lines)
  supabase/             # SETUP_ADMIN_INVITES.sql, ADD_QUESTION_ORDER.sql,
                        # functions/cleanup-unconfirmed/index.ts
  scripts/              # check-i18n-parity.mjs
  styles/               # globals.css, page.css, WelcomePage.css, menu_background.svg (dup)
  public/               # menu_background.svg, images/svgs/*.svg, images/characters/mascot.png,
                        # images/ui/default-avatar.png, images/backgrounds/.gitkeep (empty)
  middleware.ts  next.config.ts  tsconfig.json  eslint.config.mjs
  postcss.config.mjs  package.json  .env.local (COMMITTED — see §7.1)
```

**Rendering model:** predominantly Client Components (`'use client'`) with Supabase browser client (`lib/supabase.ts` via `createBrowserClient`). Server-only code is isolated to API routes + `lib/supabase-server.ts` (`supabaseAdmin` with service_role). No Server Actions, no `loading.tsx` / `error.tsx` boundaries, no `generateMetadata` per-route.

**Styling:** Tailwind v4 (`@import "tailwindcss"` in `styles/globals.css`) + CSS custom properties (`--brand-*`, `--admin-*`), utility classes (`.heading-xl/lg/md/sm`, `.chapter-grid`, `.lesson-gallery-grid`, `.modal-responsive`), focus-visible ring, confetti keyframes, `prefers-reduced-motion` support. Inline `style={{zIndex:9999,...}}` used for floating nav buttons.

---

## 2. Configuration & Toolchain

### 2.1 `package.json`

| Field | Value / Notes |
|---|---|
| `scripts` | `dev: next dev`, `build: next build`, `start: next start`, `lint: eslint`, `i18n:check: node scripts/check-i18n-parity.mjs`. **No** `test`, `typecheck` (`tsc --noEmit`), `format` (prettier). |
| `dependencies` | `next 16.1.6`, `react/react-dom 19.2.3`, `@supabase/ssr`, `@supabase/supabase-js`, `supabase ^2.81.3` (CLI shipped as runtime dep — ~heavy, should be devDep or removed), `jspdf ^4.2.1` + `jspdf-autotable ^5.0.7` (admin reports PDF export), `@ngrok/ngrok ^1.7.0` (dev tunnel for Modal webhook testing). No `zod`, `react-hook-form`, test runner. |
| `devDependencies` | `tailwindcss ^4`, `@tailwindcss/postcss ^4`, `typescript ^5`, `eslint ^9`, `eslint-config-next 16.1.6`, `@types/*`. |

**Why this state:** minimal thesis-project toolchain. `supabase` CLI as dep and `@ngrok/ngrok` suggest the team installed whatever unblocked local Supabase + Modal integration testing fastest, without pruning. Missing `typecheck`/`test` is normal for a UI-first capstone at this stage — type safety is enforced only at `next build` / editor level.

### 2.2 `next.config.ts`

```ts
images: { remotePatterns: [{ protocol:'https', hostname:'*.supabase.co',
  pathname:'/storage/v1/object/public/**' }] }
```

Only image remote-pattern. No `experimental`, `rewrites`, `headers` (no CSP/HSTS), `output`, `logging`. Correct minimal config for Supabase Storage-hosted lesson videos/thumbnails.

### 2.3 `tsconfig.json`

`target ES2017`, `strict:true`, `jsx:react-jsx`, `moduleResolution:bundler`, `paths @/* -> ./*`, `include **/*.ts|tsx|mts + .next/types`, `exclude node_modules, supabase, ../supabase`, `allowImportingTsExtensions:true`. Strict is on but codebase uses heavy `any` in admin pages (e.g. `(l:any)`), so strictness is nominal until a `typecheck` script + `noExplicitAny` cleanup is added.

### 2.4 `middleware.ts` (matcher: `/admin/:path*`, `/dashboard/:path*`, `/super-admin/:path*`)

Per-request `@supabase/ssr` server client, `getUser()` + `profiles` lookup:

- `/admin/setup`, `/admin/login`, `/admin/(auth)/login` → public.
- Other `/admin/*` → requires `profiles.role ∈ {admin, super_admin}`, else `→ /admin/login`.
- `/super-admin/*` → requires `role == super_admin`, else `→ /dashboard` (or `/admin/login` if no session). Verbose `console.log` on every check (lines 66–98) — debug leftover.
- `/dashboard/*` → requires session + `profiles.profile_id` exists, else `→ /`.

**Known gaps (with reason):**
- Matcher `/dashboard/:path*` does **not** match bare `/dashboard` (needs subpath). Bare `/dashboard` therefore relies on client-side `AuthGuard` → brief unauthenticated flash. **Reason:** Next matcher semantics oversight, not intentional; easy fix is adding `/dashboard` to matcher.
- Bare `/admin` unhandled. **Reason:** no landing page was ever designed for `/admin`; all entry points link directly to `/admin/login` or `/admin/(protected)`.
- No handling for `/`, `/reset-password`, etc. **Reason:** correctly left public; no issue.

---

## 3. Route Inventory & Feature Status

### 3.1 Public

| Route | File | Status |
|---|---|---|
| `GET /` | `app/page.tsx` (client, `Suspense`) | **Done.** Welcome BG (`public/images/svgs/welcome-bg.png`), title (`juansign-title.svg`), `ControlsCluster` (language + settings), `WelcomeButtons`, `SignupModal`, `LoginModal` (+`?verified=1` notice), `ForgotPasswordModal`, `UserProfileModal → /dashboard`. All strings via `t('welcome.*','auth.*')`. |
| `GET /reset-password` | `reset-password/page.tsx` | **Done.** |
| `GET /reactivate` | `reactivate/page.tsx` | **Done.** |
| `GET /verify-email-wait` | `verify-email-wait/page.tsx` | **Done.** |
| `GET /auth/confirm?token_hash&type\|code&next` | `auth/confirm/route.ts` | **Done.** `verifyOtp` / `exchangeCodeForSession` → `?verified=1/0`. |

### 3.2 Student (`dashboard/layout.tsx` = `AuthGuard` + `PresenceHeartbeat` + `SessionRefreshProvider`)

| Route | File | Status |
|---|---|---|
| `GET /dashboard` | `dashboard/page.tsx` | **Done.** Fetches `profiles.first_name,username`; 3 mode buttons Lessons (green) / Practice (orange) / Assessment (red); logout; settings gear. |
| `GET /dashboard/lessons` | `dashboard/lessons/page.tsx` | **Done (with unlock bug — §7.2).** Fetches `levels ORDER level_order` + `user_progress`; responsive gallery (paged ≥1024px, 8/page, `ChapterCard`), `url(/menu_background.svg)` BG. |
| `GET /dashboard/lessons/[lessonId]` | `lessons/[lessonId]/page.tsx` | **Done.** `LessonView` + `LessonPanelView`, letter pagination, `markLessonViewed/saveLastPageIndex`, on last letter marks complete + unlocks next level, `LessonCompleteModal`. |
| `GET /dashboard/practice` | `practice/page.tsx` | **Done.** Sequential unlock enforced (lesson completed / prior `practice_sessions`). |
| `GET /dashboard/practice/[chapterId]` | `practice/[chapterId]/page.tsx` | **Done.** Shuffles (or not via `settings.shuffleQuestions`), renders `PracticeView` per question, inserts `practice_sessions` on complete. |
| `GET /dashboard/assessment` | `assessment/page.tsx` | **Done.** Fetches `levels` + `/api/assessment/questions?levelId&status=active`. |
| `GET /dashboard/assessment/[chapterId]` | `assessment/[chapterId]/page.tsx` | **Done (scoring TODO).** Renders `AssessmentView` (perform→`PracticeView`, identify→`IdentifyView`), inserts `assessment_results`, unlocks next `levels.previous_level_id`, `LessonCompleteModal mode=assessment`. Explicit `TODO` at line 7: full scoring logic deferred to `AssessmentView`. |

### 3.3 Admin

| Route | Status |
|---|---|
| `GET /admin/setup` (`AdminSetupContent.tsx`) | **Done.** Invite-code + create super_admin via `/api/admin/setup-admin`. |
| `GET /admin/login` (`(auth)/login/page.tsx`) | **Done.** Calls `/api/admin/login` (Supabase + `profiles.role` check). |
| `GET /admin/(protected)/` | **Done.** Stats (`/api/admin/stats`: totalUsers/activeToday/levelsCompletedToday) + `/api/admin/dashboard` tables with skeletons. |
| `.../users`, `levels`, `settings`, `archive`, `reports` | **Done.** Levels CRUD (levels/lessons/videos/questions + `VideoSelect`), reports filters + `jspdf` export. `levels/page.tsx:245` has `console.log("niight")` debug leftover + 8 other verbose logs. |

### 3.4 Super-admin

`GET /super-admin → redirect('/super-admin/activity')`. `GET /super-admin/activity` renders only bare heading + `<AdminInviteForm/>`. **Reason for thin state:** super-admin analytics was scoped out; the invite-generation path was the only super-admin requirement for thesis defense (bootstrapping the first admin). `ActivityFeed.tsx` / `ActivityFeedItem.tsx` exist but are unwired — left for post-defense work.

### 3.5 API routes

- `POST /api/predict` — **fully implemented proxy, not a stub** (see §4).
- `GET /api/assessment/questions?levelId&status` — resilient to schema drift via `detectOrderColumn` (handles missing `status`/`is_active`/`question_order` vs `sequence_order`). **Reason:** Supabase schema evolved across migrations (`juansign_database.sql` vs `ADD_QUESTION_ORDER.sql`); shim keeps old + new DBs working.
- `POST /api/post-signup` (avatar → `avatars` bucket + `profiles` update, service_role), `GET|POST /api/profile-avatar`, `POST /api/admin/{login,logout,generate-invite,setup-admin,validate-invite}`, `GET /api/admin/{stats,dashboard,users,levels,levels-list,lessons?action=list-videos,questions,reports,settings}`.

---

## 4. ML Integration: `POST /api/predict` (Technical Deep Dive)

**File:** `front-end/app/api/predict/route.ts` (115 lines)

```
Browser (MediaRecorder / canvas frames)
  → POST /api/predict { video: base64 | frames[], levelId, questionId, ... }
      Authorization: Bearer <supabase JWT>
  → route.ts: 1) header check → 2) 3-segment JWT shape check →
     3) supabase.auth.getUser(token) via ANON key →
     4) require MODAL_ENDPOINT_URL → 5) forward {...body, token} to Modal
  → Modal (server-to-server, no CORS) → JSON { predictions:[{label, confidence}...], ... }
  → route.ts relays Modal JSON + status; non-JSON → 502; fetch failure → 500
```

Key properties:
- **Same-origin CORS avoidance is deliberate:** browser never calls `*.modal.run` directly; `MODAL_ENDPOINT_URL` stays server-only (no `NEXT_PUBLIC_` prefix). Current `.env.local` value: `https://juansign001--predict.modal.run`.
- **Auth:** shape check (`token.split('.').length===3`) is a cheap pre-filter before the real `getUser()` verification. Correct.
- **Observability gap:** line 51 `console.log('[predict route] Authenticated user:', user)` logs full user object per prediction — PII/noise in production logs. Should be debug-gated or redacted.
- **Missing:** no rate-limiting, no request-size cap (video payloads), no per-user quota. **Reason:** thesis MVP trusts authenticated students; hardening deferred until public deployment.

Consumers: `components/module/PracticeView.tsx` (recording → `/api/predict` → scoring + tips), `AssessmentView.tsx` (perform path). `sessionStorage`/Supabase writes (`practice_sessions`, `assessment_results`) happen client-side after scoring.

---

## 5. Components, Auth, Data, i18n

### 5.1 Components (~35 files)

- `welcome/`: `WelcomePage.tsx`, `WelcomeButtons.tsx`
- `signup/SignupModal.tsx`, `login/{LoginModal.tsx, ForgotPasswordModal.tsx, ResetPasswordPage.tsx}`, `auth/VerifyEmailPrompt.tsx`
- `profile/{UserProfileModal.tsx, ChangePasswordModal.tsx}`, `settings/SettingsModal.tsx`
- `module/` (core learning engine): `LessonView.tsx`, `LessonPanelView.tsx`, `LessonCompleteModal.tsx`, `PracticeView.tsx`, `IdentifyView.tsx`, `AssessmentView.tsx`, `AssessmentView.new.tsx` (**ORPHAN DUPLICATE** — own fetch+shuffle+insert; real flow uses props-driven `AssessmentView.tsx`; nothing imports `.new`), `SignDisplay.tsx`, `FocusButton.tsx`, `FocusedLessonsDropdown.tsx`
- `lessons/LessonCard.tsx` (SVG placeholder art — `Replace artSrc...`), `chapter/ChapterTemplate.tsx` (`Video placeholder — remove once...`, `Video coming soon` / `🚧 Under Development` empty states)
- `admin/{AdminSidebar.tsx, InviteGenerator.tsx, AdminSetupContent.tsx}`, `AdminInviteForm.tsx` (super-admin; overlaps `InviteGenerator.tsx` — two implementations of same flow), `activity-feed/{ActivityFeed.tsx, ActivityFeedItem.tsx}` (unwired)
- `AuthGuard.tsx`, `SessionRefreshProvider.tsx`, `PresenceHeartbeat.tsx`, `VideoSelect.tsx`

**Why duplicates/placeholders exist:** `AssessmentView.new.tsx` is an in-progress refactor fork kept alongside the working version to avoid breaking the demo path. `LessonCard`/`ChapterTemplate` placeholders exist because illustrator/video assets were never delivered — UI was built art-agnostic. `AdminInviteForm` vs `InviteGenerator` overlap is convergent evolution (super-admin vs admin flows built at different times).

### 5.2 Auth

Supabase Auth with username→email mapping (`LoginModal`, `SignupModal` with photo upload → `post-signup`), `ForgotPasswordModal`, `ResetPasswordPage`, `VerifyEmailPrompt`, `AuthGuard` session check, `SessionRefreshProvider` + `lib/useSessionRefresh.ts`, `PresenceHeartbeat`, `ChangePasswordModal`, `UserProfileModal`. Admin auth via `lib/adminAuth.ts:getAuthorizedAdmin()` (Bearer + `profiles.role`) + `lib/adminFetch.ts` client helper; `middleware.ts` mirrors it. `lib/adminInvites*.ts` for invite codes. Edge function `supabase/functions/cleanup-unconfirmed/index.ts` prunes unconfirmed accounts.

### 5.3 Supabase data layer

- `lib/supabase.ts` (browser `createBrowserClient`), `lib/supabase-server.ts` (`supabaseAdmin` service_role — correctly server-only), `lib/supabaseHealthCheck.ts`, `lib/storage.ts:listLessonVideos()` via `/api/admin/lessons?action=list-videos` + `getLessonVideoUrl()` (assumes `.mp4` only; comment mentions `.mp44` typo), `lib/lessonProgress.ts` (`hasViewedLesson`, `markLessonViewed`, `save/get/resetLastPageIndex`, `getOverallCompletionRate`, `getOverallStars`), `lib/retryUtils.ts`, `lib/adminFetch.ts`.
- Tables touched: `profiles`, `levels`, `lessons`, `practice_questions`, `assessment_questions`, `practice_sessions`, `assessment_results`, `user_progress`, `lessons_viewed`, `admin_invites`, `signs`. Schema: `juansign_database.sql` (core + RLS) + `front-end/supabase/{SETUP_ADMIN_INVITES.sql, ADD_QUESTION_ORDER.sql}`.

### 5.4 i18n

Custom (no `next-intl`): `i18n/translations.ts` (614 lines, `en`+`tl`, full parity — `npm run i18n:check` passes via `scripts/check-i18n-parity.mjs`), `context/LanguageContext.tsx` (`localStorage juansign.language`, `t(key)` with `en` fallback + `humanizeKey`), `hooks/useLanguage.ts` re-export. `hooks/useSettings.ts` (`SettingsProvider`, `localStorage juansign.settings`: sound/music/language/timer/confirm/review/captions/autoplay/speed/shuffle/showAnswer). All user strings go through `t()`, but hardcoded English remains in a few result/empty states (`Assessment Complete!`, `Excellent!`, `Close matches`, `Predicted:`, `Checking session...`). **Reason:** those strings were added after the last i18n pass; parity script only checks keys present in `translations.ts`, not hardcoded literals in JSX.

---

## 6. Assets & Styling Notes

- `public/menu_background.svg` (used via `url(/menu_background.svg)` in dashboard pages) **and** `styles/menu_background.svg` duplicate — **reason:** one copy was added for CSS reference, one for Next static serving; harmless but should dedupe to `public/` only.
- `app/page.tsx` imports `../../public/images/svgs/welcome-bg.png` + `juansign-title.svg` — verify casing on Linux (`welcome-bg.png` exists; case-sensitive deploy risk).
- `public/images/backgrounds/.gitkeep` empty, `characters/` only `mascot.png` — **reason:** background/character art pipeline never completed; pages fall back to SVG + CSS gradients.
- `LessonView` video URLs come from Supabase Storage; empty bucket → placeholder. Expected until content team uploads.
- `front-end/README.md` is stock create-next-app; canonical setup docs live in repo-root `README.md`.

---

## 7. Gaps, Risks & Rationale

### 7.1 Secrets committed (HIGH)

`.env.local` is present in the working tree with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_JWT_SECRET`, `MODAL_ENDPOINT_URL`, `SUPABASE_SERVICE_ROLE_KEY=eyJ...`, `ADMIN_EMAIL/PASSWORD/NAME/SECRET` (`ADMIN_PASSWORD=phanini`), `NEXT_PUBLIC_APP_VERSION=v1.0`, `NEXT_PUBLIC_ENV=Production`, `NEXT_PUBLIC_LAST_UPDATE=January 15, 2026` — despite `.gitignore` covering `.env*`. **Why:** committed for shared-thesis-machine convenience (teammates pull and run without secret exchange). **Action:** rotate `SERVICE_ROLE_KEY` + admin creds, `git rm --cached front-end/.env.local`, add `.env.example`, purge history if pushed.

### 7.2 Lessons unlock disabled (MEDIUM)

`app/dashboard/lessons/page.tsx:107-117` builds `unlockedIds` from `user_progress` then ignores it (`isUnlocked: true` for all). Practice page enforces sequential locking correctly. **Why:** intentionally relaxed so testers/defense panel can jump to any chapter without grinding prerequisites; the `LockIcon` UI is already built, so re-enabling is a one-line change (`isUnlocked: unlockedIds.has(lvl.level_id) || i===0`).

### 7.3 Dead code (LOW)

`app/api/admin/generateinvite.ts` (87 lines, lowercase, no `route.ts` → never routed; live is `generate-invite/route.ts`), `app/api/admin/setup/create-user.ts` (never routed), `app/reorganize.bat` (hardcoded `C:\Users\Lenovo©\Desktop\4th Year Files\...`), `AssessmentView.new.tsx`. **Why:** iterative development without cleanup passes. Safe to delete after confirming no imports.

### 7.4 Observability / hardening (MEDIUM)

76 `console.*` across `app/`, PII logging in `predict`, no rate limits, no `error.tsx`/`loading.tsx`, `window.confirm()` in `.new.tsx`, `zIndex:9999` inline buttons. **Why:** demo-first; acceptable for controlled thesis deployment, must address before public launch.

### 7.5 Test / type safety (MEDIUM)

No unit/e2e tests, no `typecheck` script, heavy `any` in admin pages, `supabase` CLI in runtime deps. **Why:** team validated via manual QA + `next build`; test harness was explicitly descoped. Adding `tsc --noEmit` + vitest + Playwright smoke (login → lessons → practice predict mock) is the recommended next milestone.

---

## 8. Completeness Assessment

| Area | Status |
|---|---|
| Welcome + signup/login/forgot/reset/verify/reactivate | ✅ Done |
| Dashboard hub, lessons list+detail + progress persistence | ✅ Done (unlock flag Quan) |
| Practice recording → `/api/predict` → Modal → scoring + tips | ✅ Done (needs Modal endpoint live) |
| Assessment identify+perform → results + unlock | ✅ Done (scoring TODO minor) |
| Admin dashboard/users/levels/lessons/questions/reports/settings/archive + invites | ✅ Done |
| i18n en/tl parity, settings modal, presence heartbeat, PDF reports | ✅ Done |
| Super-admin analytics, activity feed wiring | 🚧 Scoped out |
| Lesson videos / illustrations / backgrounds | ❌ Missing (content pipeline) |
| Tests, `.env.example`, production README, rate-limiting, anti-cheat timer | ❌ Missing (post-defense backlog) |

**Next recommended actions (frontend-only):** 1) rotate + uncommit secrets, 2) re-enable `isUnlocked`, 3) delete 4 dead files, 4) gate `console.log`, 5) add `typecheck` + `.env.example`, 6) wire or remove `ActivityFeed`, 7) merge or delete `AssessmentView.new.tsx`.
