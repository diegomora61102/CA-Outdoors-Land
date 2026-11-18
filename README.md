# CA Outdoors Land

A map of California public land (BLM, National Forest, National Park) with campgrounds, trailheads,
trails, lakes and highways. Each place shows amenities, nearby campgrounds, open/closed status,
emergency closures, nearby wildfires, NWS alerts, current weather and a 7-day forecast. People can
sign in, save places, and share a link to one place (`?site=<id>`) or a whole list (`?list=<id>`).

## How it fits together

| Part | What it is | Where |
|---|---|---|
| Website | Static HTML/JS (Leaflet map, USGS basemaps) | `site/` → Cloudflare Pages |
| Map data | Land, campgrounds, trails, lakes, highways as JSON | `site/data/`, rebuilt monthly |
| Live data | Weather, status, alerts in a `feeds` table | Supabase |
| Accounts | Email sign-in links (optional Google), favorites, shared lists | Supabase Auth + tables |
| Scheduled jobs | Python scripts (standard library only) | `pipeline/` + `.github/workflows/` |

| Job | Schedule | Script |
|---|---|---|
| Weather (NWS stations + forecasts, elevation-adjusted estimates) | Hourly at :07 | `pipeline/weather.py` |
| Temporary closures, wildfires within 10 mi, NWS alerts | Hourly at :37 | `pipeline/alerts.py` |
| Forest Service open/closed status | Daily, 4:23 AM Pacific | `pipeline/status.py` |
| Land and site data (BLM, USFS, Census) | Monthly, on the 3rd | `pipeline/sources.py` → `build_data.py` → `wx_sites.py` |

Clicking a place never calls a weather or alerts service: the jobs store results, and the page reads them.

## Setup

### 1. Supabase (accounts + live data)
1. Create a project at supabase.com.
2. **SQL Editor → New query**: paste `supabase/schema.sql` and run it, then do the same with `supabase/02_reviews.sql`.
3. **Authentication → URL Configuration**: set *Site URL* to your website address (for example
   `https://ca-outdoors-land.pages.dev`) and add the same address under *Redirect URLs*.
4. **Project Settings → API**: copy the *Project URL* and the *publishable* key (or legacy *anon* key) into
   `site/assets/config.js`. (The anon key is safe to publish; row-level security protects the data.)
5. Optional: enable Google under **Authentication → Providers**, then set `googleSignIn: true` in `config.js`.

### 1b. Accounts (username or email + password)
1. **SQL Editor**: run `supabase/03_usernames.sql` (usernames table and sign-up check).
2. **Authentication → Sign In / Providers → Email**: keep *Email* enabled. *Confirm email* on means new
   accounts must click a link before signing in.
3. Supabase's built-in email sender only allows a few emails an hour. Before launch, set up your own
   sender under **Authentication → Emails → SMTP Settings** (for example Resend or SendGrid).
4. **Cloudflare → your Worker → Settings → Variables and Secrets → Add**: type *Secret*, name
   `SUPABASE_SECRET_KEY`, value = the Supabase secret key. This lets the site turn a username into its
   email on the server (`worker/index.js`), so emails are never exposed to browsers. Without it, people
   can still sign in with their email.

### 2. GitHub Actions secrets (lets the scheduled jobs write live data)
In the repository: **Settings → Secrets and variables → Actions → New repository secret**:
- `SUPABASE_URL`: the Project URL
- `SUPABASE_SERVICE_ROLE_KEY`: *Project Settings → API Keys → secret* key (`sb_secret_…`, or the legacy *service_role* key). Keep this secret; it is
  only used by the jobs, never in the website.

Then run each workflow once by hand (**Actions → pick the workflow → Run workflow**) to fill the data.

### 3. Cloudflare (hosting)
`wrangler.jsonc` tells Cloudflare to serve the `site/` folder as static files.
1. dash.cloudflare.com → **Workers & Pages → Create → Import a repository** → pick this repository.
2. *Project name*: `ca-outdoors-land` (must match `"name"` in `wrangler.jsonc`; change one to match the other).
   *Build command*: leave empty. *Deploy command*: `npx wrangler deploy` (the default).
3. Deploy. Every push (including the monthly data commit) redeploys automatically. The address is
   `https://ca-outdoors-land.<your-subdomain>.workers.dev`; add it in Supabase under
   **Authentication → URL Configuration** (Site URL and Redirect URLs).

### GitHub Actions minutes
The hourly weather job takes about 7 minutes. That's free and unlimited on a **public** repository.
On a private repository the free plan includes 2,000 minutes a month, which hourly weather would
exceed; change its cron to every 3 hours (`'7 */3 * * *'`) or make the repository public. Nothing
secret lives in the code.

## Running locally
```bash
python3 -m http.server 8000 --directory site
```
Then open http://localhost:8000. Without Supabase settings the map still works; weather, status,
alerts and sign-in stay off. To test a job without Supabase, give it an output folder:
`python3 -I pipeline/alerts.py out/` writes the feed as JSON instead.

## Data sources
BLM (gis.blm.gov), USDA Forest Service (apps.fs.usda.gov), US Census TIGERweb, National Weather Service
(api.weather.gov), NIFC/WFIGS wildfire perimeters, USGS National Map basemaps. All public; no API keys.
BLM does not publish open/closed status, so BLM sites show closures only through wildfire and NWS alerts.
