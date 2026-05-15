# RankFix — Free AI SEO check

Scans a website and returns a prioritised list of fixes to make it citable by ChatGPT, Claude, Perplexity, and Google AI Overviews.

- Open rubric: [docs/rubric.md](docs/rubric.md)
- Working brand: **RankFix** (final name pending; deferred to launch)
- Hosting: Cloudflare Pages + Pages Functions (no Workers project, no wrangler, no local install)

## Layout

```
/
├── index.html              # landing + scanner UI
├── styles.css
├── app.js                  # form + render + share-link logic
├── rubric.html             # human-readable rubric
├── _redirects              # /r/* → /index.html (SPA routing for share links)
├── functions/              # server-side, automatically routed by Pages
│   ├── api/
│   │   ├── scan.ts         # POST /api/scan
│   │   └── r/
│   │       └── [id].ts     # GET /api/r/:id (share-link reader)
│   ├── types.d.ts          # minimal Cloudflare types (editor-only)
│   └── _lib/               # shared scanner code (underscore prefix = not routable)
│       ├── fetcher.ts
│       ├── extractor.ts
│       ├── page-selector.ts
│       ├── pagespeed.ts
│       ├── scoring.ts
│       ├── kv.ts
│       ├── deep-links.ts
│       ├── types.ts
│       └── checks/         # eight check modules
├── docs/
│   └── rubric.md
└── reports/                # trend research
```

No `package.json`, no `wrangler.toml`, no `node_modules`. Cloudflare compiles the TypeScript automatically at build time.

## Deploy

Same pattern as the rest of my Cloudflare sites: push to GitHub, Cloudflare Pages auto-builds.

1. **Create the GitHub repo** (private or public; doesn't matter for Cloudflare)

   ```sh
   cd D:\TrainingAI\geo-check
   git init
   git add .
   git commit -m "Initial scanner + UI"
   git remote add origin https://github.com/<you>/rankfix.git
   git push -u origin main
   ```

2. **Connect to Cloudflare Pages**
   - Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git
   - Pick the repo
   - Build settings:
     - Framework preset: **None**
     - Build command: *(leave blank)*
     - Build output directory: `/`
   - Deploy

3. **Add the KV namespace** (for share links — optional but recommended)
   - Dashboard → Workers & Pages → KV → Create a namespace → name it `rankfix-shares`
   - Back in the Pages project → Settings → Functions → KV namespace bindings → Add
     - Variable name: `SHARES`
     - KV namespace: `rankfix-shares`
   - Redeploy (Settings → Deployments → Retry latest)

4. **Add the PageSpeed Insights key** (optional — unlocks Core Web Vitals checks)
   - Get a free key at <https://developers.google.com/speed/docs/insights/v5/get-started>
   - Pages project → Settings → Environment variables → Production → Add
     - Variable name: `PAGESPEED_API_KEY`
     - Value: paste the key
   - Redeploy

5. **Custom subdomain**
   - Pages project → Custom domains → Set up a custom domain → enter the subdomain (e.g. `rankfix.yourdomain.com`)
   - Cloudflare creates the DNS record automatically since the apex is already on Cloudflare

## Iterating

Edit code → commit → push. Cloudflare builds a preview deploy for every branch and PR, plus production for `main`. Build time is typically 30-60 seconds.

There is no local dev server. If you want one later, that's a separate decision (would reintroduce wrangler or a Node TLS workaround).

## Endpoints

- `POST /api/scan` — body `{ "url": "https://example.com" }` → returns `ScanResult`
- `GET /api/r/:id` — returns a saved scan (404 if expired / not found)

Share URLs are `https://your-domain/r/<id>`. The `_redirects` file makes the static site serve `index.html` for any `/r/*` path; `app.js` then detects the path and fetches the API.

## Status

- [x] M1-M7: scanner core, full check catalogue, page-type sampler, scoring, UI, share links, public rubric
- [x] Refactored from Worker + Pages to single Pages project with Functions (matches existing site pattern)
- [ ] Push to GitHub
- [ ] Connect to Cloudflare Pages
- [ ] Bind KV + secrets in dashboard
- [ ] Custom subdomain
- [ ] M8 — Turnstile + rate-limiting (post-launch)
