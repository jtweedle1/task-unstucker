# Task Unstucker

A mobile-first web app that helps you get started on a task when you're stuck. Type what you're
stuck on, and it gives you one small first step, a two-minute timer, and a way to make the step
even easier. It's designed with ADHD and executive dysfunction in mind, but it's a productivity
tool, not medical advice or treatment.

Everything is saved on your device (IndexedDB). There are no accounts. The only thing that ever
leaves the device is the text of the task you ask the AI about, and only after you agree.

## What's in Phase 1

- **First step ("First Domino")**: one small step, with Make it easier, Try another, and I've done it.
- **Task Breaker**: break a task into small steps, edit them, reorder them, and refine the plan
  ("smaller steps", "only 5 minutes", or your own words). You see a preview before anything
  changes, finished or hand-edited steps are never changed without asking, and every change can be undone.
- **Two-Minute Launch** and **Focus Sprints** (3, 5, 10, 25 minutes or custom). The timer uses
  timestamps, so it stays right after locking the phone, switching apps, or reloading.
- **Parking Lot**: park a stray thought during a timer without leaving it.
- **Stuck Diagnosis**: optional "why is it hard?" chips that suggest an approach (rules, no AI).
- **Resume**: the home screen offers the step you were on.
- **Tasks**: in progress, saved for later, done; delete with undo.
- **Gentle progress**: a momentum note and small celebrations. Can be set to quiet or off. No streaks.
- **Backup**: download and restore a JSON backup (merge or replace).
- **AI modes**: live AI through a server proxy, a clearly labeled demo mode, or off. If AI fails
  or you're offline, you get built-in quick steps instead.
- **Installable PWA** with an update prompt, offline app shell, reduced motion support.

Task Roulette, Good Enough Mode, energy matching and the rest are planned for Phase 2.

## Run it locally

Requires Node 22+.

```sh
npm install
npm run dev        # http://localhost:5173
```

Without an API key the app still works: choose **Demo** or **Off** in Settings, or keep
**Use AI** and you'll get quick steps with a note that AI isn't set up.

Other commands:

```sh
npm run check      # format, lint, typecheck, unit tests, production build
npm test           # unit and integration tests (Vitest)
npm run test:e2e   # end-to-end tests (Playwright, Chromium at iPhone sizes)
npm run build && npx vite preview   # production build with the AI proxy on :4173
```

## Turn on live AI (Anthropic)

The API key lives only on the server side. It is never put in the app bundle.

1. Create an API key in the [Anthropic Console](https://console.anthropic.com/). Usage is billed
   to that account.
2. Copy `.env.example` to `.env.local` and fill in `ANTHROPIC_API_KEY=...`. `.env.local` is git-ignored.
3. Optional settings in the same file:
   - `AI_MODEL`: defaults to `claude-opus-5-5`. A smaller model such as `claude-haiku-5-5` costs less.
   - `APP_ACCESS_CODE`: if set, the app must send this code (entered in Settings) before the
     proxy will call the AI. Use this before sharing a deployed link, so strangers can't spend your credits.
4. Restart `npm run dev`. The first time you ask for steps, the app asks your OK before sending task text.

Requests use structured output, adaptive thinking at low effort, and Anthropic's server-side
fallback beta (`server-side-fallback-2026-07-01`), which lets the API retry on another model if
a safety classifier declines.

## Deploy (Cloudflare Pages, free tier)

Not deployed yet. Deploying is your call. These are the steps when you're ready:

1. In Cloudflare: Workers & Pages → Create → Pages → connect this GitHub repo.
2. Build command `npm run build`, output directory `dist`. The `functions/` folder becomes the
   `/api/ai` endpoint automatically.
3. Settings → Variables and Secrets: add `ANTHROPIC_API_KEY` (as a secret) and ideally
   `APP_ACCESS_CODE`. Optionally `AI_MODEL`.
4. Redeploy. Security headers come from `public/_headers`.

The proxy's rate limit (30 requests per hour per IP) is per server instance and best-effort. The
access code is the real protection for a shared link.

## Test on an iPhone

**Quick look over Wi-Fi (no install, no offline):**

1. Run `npm run dev` on your computer. It prints a "Network" address like `http://192.168.1.20:5173`.
2. With the iPhone on the same Wi-Fi, open that address in Safari.

Over plain `http` to a LAN address, iOS won't run the service worker, so offline mode and the
update prompt won't work this way. Everything else does.

**Full PWA test (Add to Home Screen, offline):** needs an `https` address, such as a Cloudflare
Pages preview deploy (see above) or a tunnel. Then in Safari: Share → Add to Home Screen, open it
from the Home Screen, and try it in Airplane Mode.

Things worth checking on a real phone: the keyboard doesn't cover the input, the timer is right
after locking the phone for a few minutes, text stays readable with large Dynamic Type sizes, and
VoiceOver reads the timer and buttons sensibly.

Note: automated tests run in Chromium with iPhone-sized screens. That's not Safari's engine and
not a real phone, so the checks above still matter.

## Privacy and data

- Data stays in this browser's storage on this device. Safari can clear website data in some
  cases (less likely once added to the Home Screen), so download a backup now and then.
- Live AI sends only the current task: its title, the optional "why it's hard" choice, its steps, and
  what you type when asking for changes.
  The proxy doesn't log task text.
- Settings → Delete all data removes everything from the device.

## Project layout

```
src/domain/   pure logic: plans, timer, diagnosis, templates, rewards
src/data/     IndexedDB (Dexie), repository, backup
src/ai/       client-side AI orchestration, schemas, demo data, offline rules
src/ui/       screens and components
server/       AI proxy handler and provider adapters (Anthropic)
functions/    Cloudflare Pages Function entry for /api/ai
e2e/          Playwright tests
```

The AI layer is provider-independent: `server/provider.ts` is the interface, and
`server/anthropic.ts` is the only file that knows about a vendor.
