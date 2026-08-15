# SteveJung-Portfolio

Steve Jung's personal portfolio site — Product Designer & Creative Technologist
working across UX design, front-end development, and AI-powered automation.

Static HTML/JS, bilingual (English + Korean), deployed on Vercel at
[stevejung.dev](https://stevejung.dev). The pages need no build step; the one
serverless function under `api/` does.

## Routes

| URL | File |
| --- | --- |
| `/` | `index.html` |
| `/case-study` | `case-study.html` |
| `/ko` | `ko/index.html` |
| `/ko/case-study` | `ko/case-study.html` |

`vercel.json` sets `cleanUrls`, `trailingSlash`, and the `api/` function's
included files. There are no rewrites: the Korean routes are real files,
because Vercel consults the filesystem before any rewrite rule.

## Structure

- `index.html`, `case-study.html` — the two page templates. They are also the
  English pages as served.
- `ko/` — **generated**. Korean copies of the two templates. Do not edit by
  hand; see *Editing* below.
- `i18n/en.js`, `i18n/ko.js` — all site copy per language, including the head
  (title, description, Open Graph). The pages and the AI agent both read from it.
- `i18n/locale.js` — locale runtime. Detects the language from the URL and
  rewrites `data-lp` links so one template serves both languages.
- `support.js` — rendering runtime (generated from `dc-runtime`; loads
  React/ReactDOM/Babel from CDN and handles templating). Do not edit.
- `image-slot.js` — `<image-slot>` image component, used for the case galleries
  and lightbox.
- `ai-steve.js` — the floating AI chat widget.
- `api/ai-steve.js` — the widget's answer endpoint (Vercel serverless function).
- `images/` — case screenshots and photos, one folder per case.
- `pdf/` — the résumé and the portfolio PDFs linked from the contact section.
  `pdf/docs/` holds the case-study documents.
- `pdf/Case */` — original source archive. Kept in the repo, excluded from the
  deployment by `.vercelignore`.
- `tools/` — generators. Excluded from the deployment.
- `sitemap.xml` — **generated**. `robots.txt`, `og-image.png` — hand-maintained.

## AI Steve

The chat widget answers from `i18n/<locale>.js` — the same copy the pages render
— so editing the site copy is what changes the agent's knowledge; there is
nothing to regenerate. Replies may link only to routes in the catalog the
endpoint builds from that copy, so an answer cannot point at a page that does
not exist. To see that catalog:

```bash
node -e "console.log(require('./api/ai-steve.js').__internals.siteData('en').links)"
```

The endpoint needs `ANTHROPIC_API_KEY` set in the Vercel project's environment
variables. Without it, the widget falls back to a "reach Steve directly"
message, and the rest of the site is unaffected.

## Editing

Edit the templates (`index.html`, `case-study.html`) and the copy files
(`i18n/en.js`, `i18n/ko.js`), then regenerate:

```bash
node tools/sync-locale-pages.mjs
```

That writes `ko/`, stamps the static `<head>` into all four pages, and rewrites
`sitemap.xml`. The head is static rather than script-injected because the
things that read it — LinkedIn/Slack/KakaoTalk preview bots, Google's hreflang
handling, Bing and Naver — do not reliably run JavaScript.

To verify nothing is stale (exits non-zero if it is):

```bash
node tools/sync-locale-pages.mjs --check
```

Asset references in the templates must be root-absolute (`/images/…`,
`/pdf/…`). A relative path resolves against `/ko/` and 404s on the Korean
routes.

### Image asset manager

`node tools/asset-manager/build.mjs` builds a standalone page listing every
image wired into the site, read from `case-study.html` and `index.html` so it
cannot drift. Output is `tools/asset-manager/asset-manager.html` (git-ignored).

## Local preview

Any static file server works, e.g.:

```bash
npx serve .
```

Then open http://localhost:3000

Note that `api/ai-steve.js` does not run under a plain static server; use
`vercel dev` if you need the chat widget locally.

## Deployment

Deployed via Vercel, connected to this GitHub repo. Every push to `main`
triggers an automatic redeploy. The pages are plain HTML/JS with no build step;
`package.json` exists only so Vercel installs the dependencies the `api/`
function needs. `.vercelignore` keeps the source archives (`pdf/Case*`,
`tools/`) out of the deployment.
