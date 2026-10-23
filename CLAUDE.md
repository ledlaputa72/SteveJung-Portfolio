# CLAUDE.md

Bilingual (EN/KO) static portfolio deployed on Vercel at stevejung.dev.
README.md has the full structure; this file is the rules that break the site
when missed.

## Generated files — never edit by hand

- `ko/` (both pages), the `<head>` of all four pages, and `sitemap.xml` are
  written by `tools/sync-locale-pages.mjs`.
- `support.js` is generated from `dc-runtime`.

Edit the sources instead — `index.html`, `case-study.html`, `i18n/en.js`,
`i18n/ko.js` — then run:

```bash
npm run sync-locales    # regenerate ko/, heads, sitemap.xml
npm run check-locales   # exits non-zero if anything is stale
```

Commit the sources and the regenerated files together.

## Asset paths

Use root-absolute paths only: `/images/…`, `/pdf/…`. A relative path resolves
against `/ko/` and 404s on the Korean routes.

Link PDFs only from `pdf/docs/` or `pdf/Steve-Jung-Resume.pdf`. `pdf/Case*/` is
a source archive excluded by `.vercelignore`, so links into it 404 in
production. `tools/` is excluded too.

## Copy

- All site copy, including title/description/Open Graph, lives in
  `i18n/en.js` and `i18n/ko.js`. Every copy change goes into both.
- The AI Steve chat endpoint (`api/ai-steve.js`) reads the same `i18n/` files
  plus `content/recruiter-notes.md` at runtime, so editing copy changes its
  knowledge with nothing to regenerate. Keep those notes consistent with the
  copy; the copy wins if they disagree.

## Workflow

1. Run `npm run check-locales` before starting — it should pass.
2. Work on a feature branch. Never push to `main`: every push to `main`
   auto-deploys to production via Vercel.
3. Run `npm run sync-locales`, then `npm run check-locales` again before
   committing.

## Local preview

`npx serve .` serves the pages. The chat widget needs `vercel dev` and
`ANTHROPIC_API_KEY`; without the key it falls back to a contact message.
