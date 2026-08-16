# SteveJung-Portfolio

Steve Jung's personal portfolio site — B2B Hardware Marketing Manager who plans, designs, codes, and ships.

## Structure

- `index.html` — Main portfolio / landing page
- `case-study.html` — Case studies page
- `support.js` — Rendering runtime (loads React/ReactDOM/Babel from CDN, handles templating)
- `image-slot.js` — Image placeholder component
- `i18n/` — All site copy, per language; the pages and the AI agent both read from it
- `ai-steve.js` — The floating AI chat widget
- `api/ai-steve.js` — The widget's answer endpoint (Vercel serverless function)

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

## Status

This is v1 of the site, exported from a design draft. Image slots (`<image-slot>`) currently render as placeholders — real images/screenshots need to be added over time by setting a `src` attribute on each `<image-slot>` tag, or by replacing the tag with a normal `<img>`.

## Local preview

Any static file server works, e.g.:

```bash
npx serve .
```

Then open http://localhost:3000

## Deployment

Deployed via Vercel, connected to this GitHub repo. Every push to `main` triggers an automatic redeploy. The pages are still plain HTML/JS with no build step; `package.json` exists only so Vercel installs the dependencies the `api/` function needs.
