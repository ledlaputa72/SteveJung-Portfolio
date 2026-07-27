# SteveJung-Portfolio

Steve Jung's personal portfolio site — B2B Hardware Marketing Manager who plans, designs, codes, and ships.

## Structure

- `index.html` — Main portfolio / landing page
- `case-study.html` — Case studies page
- `support.js` — Rendering runtime (loads React/ReactDOM/Babel from CDN, handles templating)
- `image-slot.js` — Image placeholder component

## Status

This is v1 of the site, exported from a design draft. Image slots (`<image-slot>`) currently render as placeholders — real images/screenshots need to be added over time by setting a `src` attribute on each `<image-slot>` tag, or by replacing the tag with a normal `<img>`.

## Local preview

Any static file server works, e.g.:

```bash
npx serve .
```

Then open http://localhost:3000

## Deployment

Deployed via Vercel, connected to this GitHub repo. Every push to `main` triggers an automatic redeploy — no build step required (static HTML/JS).
