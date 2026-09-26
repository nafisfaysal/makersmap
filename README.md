# MakersMap

A city-level atlas of makers, founders, designers, and developers. People appear on the map from two sources: they add themselves, or they posted a public introduction on X ("I'm 29. Solo founder from Brazil, based in Barcelona. Looking to connect with…") and the importer listed them from that one post. Every pin is a real person; there is no sample data.

![The atlas: a world map with clustered maker pins](docs/screenshots/map.png)

## A tour

**The atlas.** A MapLibre world map with clustering. Click a country or a cluster and everyone in that place is listed right under the map, with "Open to meet" and "Open to connect" badges. Open a profile and come back to the same spot on the map.

![Everyone in a place, listed under the map](docs/screenshots/place.png)

**Meet someone interesting.** Cards for every maker, filtered by role group (Founders, Developers, Designers, Creators, Business), by what they're looking for, and by who is nearby. More load as you scroll.

![Maker cards](docs/screenshots/people.png)

**Ask the atlas.** Natural-language search over the roster: "founders in Warsaw who want to meet for lunch" zooms the map and explains why each match fits.

![Ask the atlas results](docs/screenshots/ask.png)

**Profiles built from one post.** The intro post is pinned (this one is [@dotnafis](https://x.com/dotnafis/status/2101745412201738407), the maintainer), and the role, city, local time, what they're building, what they're looking for, and what they can help with come from the post and the X bio. Owners claim the pin with Sign in with X and then control every word.

![A maker profile](docs/screenshots/profile.png)

**Projects with a real website.** A project is listed only when it has a site we can visit (never an X post or a social profile). The name, one-line pitch, and summary are written from the site itself, links are re-checked weekly, and the Visit button goes straight to the site.

![The project catalogue](docs/screenshots/projects.png)

**Leaderboard and city pages.** Countries and cities ranked by makers, with role breakdowns, "new this week", and "up for coffee".

![Leaderboard](docs/screenshots/leaderboard.png)

![A city page](docs/screenshots/city.png)

**Share cards.** A downloadable card for every pin, match, city, and country, with a ready-to-post caption.

![A share card](docs/screenshots/share.png)

**Also in the box**

- An admin console for the importer, the review queue, and outreach (replies under intro posts from a connected X account, capped per day).
- Weekly "who looked at your pin" emails with a one-click unsubscribe.
- A public API in three tiers so the map stays fast: dots, cards for what's on screen, and rows per place.

## Stack

React 19 with the Next-style app directory via [vinext](https://github.com/vinext) on Vite, Tailwind, shadcn/ui, MapLibre GL, MongoDB. Deploys to Cloudflare Workers. Post reading, project summaries, search, and intros use a language model through OpenRouter (any model; GPT-4o mini by default) or the Anthropic API.

## Running it

```bash
corepack pnpm install
cp .env.example .env   # fill in the values below
corepack pnpm dev      # http://localhost:5173
```

Environment variables (see `.env.example`):

| Variable | Needed for |
|---|---|
| `MONGODB_URI`, `MONGODB_DB` | Everything. A local MongoDB works. |
| `TWITTERAPI_IO_KEY` | Importing intro posts (twitterapi.io). `X_BEARER_TOKEN` is the X API fallback. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Reading posts, project summaries, search, intros. Or `ANTHROPIC_API_KEY`. |
| `ADMIN_SECRET` | The admin console at `/admin` and the daily job. |
| `SESSION_SECRET` | Signing the login cookie. |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | Sign in with X (OAuth 2.0 web app; callback `<SITE_URL>/api/auth/x/callback`). |
| `X_REQUEST_EMAIL` | `true` to also collect the signer's email. Turn on "Request email from users" in the X app first, or X refuses the sign-in. |
| `SITE_URL` | The public origin, for OAuth callbacks and links. |
| `RESEND_API_KEY`, `EMAIL_FROM` | Weekly emails (optional). |
| `PLAUSIBLE_DOMAIN` | Cookie-free analytics (optional). |
| `DATAFAST_WEBSITE_ID` | DataFast pageviews and product events (optional). |
| `POSTHOG_KEY`, `POSTHOG_HOST` | PostHog pageviews and product events (optional). The project key starts with `phc_`; the host defaults to `https://us.i.posthog.com` (EU projects: `https://eu.i.posthog.com`). |

Without a model key the importer falls back to a rules-based reader. Without X credentials, claiming and joining with X are disabled and the manual join form still works.

## How the data flows

1. **Import** (`lib/x-pipeline.ts`): searches X for intro posts with several query patterns over a window, skips posts already seen, and reads each new one with the model (`lib/x-extract.ts`) to get role, place, interests, what they're looking for, and projects. Places are geocoded (`lib/geocode.ts`). Low-confidence reads go to the review queue instead of the map.
2. **Projects** (`lib/site-reader.ts`): a project needs a link we can visit. Shortened links are expanded, social profiles and stores are rejected, the page is read, and the model writes the name, pitch, and summary from it. Dead links are pruned weekly.
3. **Claim or join** (`lib/join-from-x.ts`): Sign in with X either claims the listed pin or builds a new one from the X profile. People without X use the form and get a private edit key.
4. **Daily job** (`GET /api/cron/daily?key=<ADMIN_SECRET>`): incremental import, deleted-post check, link re-check, outreach replies (if enabled), weekly digests. Call it from any scheduler.

The public API serves three tiers: dots for the map (`/api/makers`), card details for what's on screen (`/api/makers/cards?ids=`), and rows per place (`/api/makers/place?country=`). Claim tokens, edit keys, emails, and review state never leave the server.

## Privacy and removal

Listed pins hold only what the person made public: name, handle, photo, bio, the city they named, and the one intro post. They carry a no-index instruction until claimed. Anyone can remove their pin by signing in with the same X account at `/remove`. See `/privacy` and `/terms` in the app.

## Contributing

Type-check with `corepack pnpm exec tsc --noEmit` and lint with `corepack pnpm lint` before opening a pull request. Keep the data rules: nothing invented, nothing from outside X posts, X profiles, and the projects' own websites.

## License

MIT. See `LICENSE`.

## Secrets and the database

Secrets live only in `.env` (ignored by git) and, in production, in Cloudflare Worker secrets set with `wrangler secret put NAME`. A production build leaves every secret out of the generated Worker config; only non-secret settings (`MONGODB_DB`, `OPENROUTER_MODEL`, `EMAIL_FROM`, `SITE_URL`, `PLAUSIBLE_DOMAIN`, `DATAFAST_WEBSITE_ID`, `POSTHOG_KEY`, `POSTHOG_HOST`) are inlined. `readEnv` in `db/index.ts` reads the Cloudflare binding first and the process environment second.

The repository ships with no data. The database holds people's private fields (emails, edit keys, claim tokens) and is never published. To move a database between environments use MongoDB's own tools:

```bash
mongodump --uri "$SOURCE_URI" --db makersmap --out ./dump
mongorestore --uri "$TARGET_URI" --db makersmap ./dump/makersmap
```

Collections: `makers` (people and projects), `counters` (id allocation), `geocache`, `sitecache`, `intro_cache` (model outputs, safe to drop), `import_state`, `signals`, `settings` (operator tokens, sensitive).
