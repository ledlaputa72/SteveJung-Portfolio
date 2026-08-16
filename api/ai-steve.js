/**
 * AI Steve — the chat widget's answer endpoint.
 *
 * Knowledge comes from i18n/<locale>.js, the same file the pages render from,
 * evaluated here against a stub `window`. That keeps one source of truth: an
 * edit to the site copy changes what the agent knows on the next request, with
 * nothing to regenerate. vercel.json ships i18n/ with this function so the read
 * resolves at runtime.
 *
 * The model answers in the visitor's language and returns links only from the
 * catalog built below, so a reply can never invent a route. Structured outputs
 * enforce that shape rather than asking the model to format it by hand.
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5';
const LOCALES = { en: '', ko: '/ko' }; // locale -> path prefix
const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY_TURNS = 12;

const client = new Anthropic();

// ------------------------------------------------------------- site copy

/**
 * i18n/<locale>.js is a browser file that assigns to window.SITE_COPY. Running
 * it against a stub window is what lets the copy stay in exactly one place.
 */
function loadCopy(locale) {
  // Bundled next to the function on Vercel and sitting in the repo root
  // locally; try both rather than depending on the working directory.
  const candidates = [
    path.join(__dirname, '..', 'i18n', locale + '.js'),
    path.join(process.cwd(), 'i18n', locale + '.js')
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) throw new Error('i18n/' + locale + '.js not found in ' + candidates.join(', '));
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { timeout: 5000 });
  const copy = sandbox.window.SITE_COPY && sandbox.window.SITE_COPY[locale];
  if (!copy) throw new Error('i18n/' + locale + '.js did not define SITE_COPY.' + locale);
  return copy;
}

/** An external link in the copy is stored bare ("starllion.com"). */
const absolute = (url) => (/^https?:\/\//.test(url) ? url : 'https://' + url);

/**
 * Every place a visitor can be sent. The model picks from this list by url, so
 * anything absent here simply cannot be linked.
 */
function buildLinkCatalog(copy, prefix) {
  const links = [];
  const seen = new Set();
  const add = (url, label, about) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    links.push({ url, label, about });
  };
  // trailingSlash is off in vercel.json, so the locale root is "/" or "/ko" —
  // never "/ko/", which would redirect before the fragment is applied.
  const home = prefix || '/';

  // The "about" text is what the model routes on, so each generic destination
  // says when it is the right answer — otherwise the index reads as a safe
  // catch-all and wins over the case study that actually answers the question.
  add(home + '#top', 'Home',
    'The landing page. For questions about Steve overall, not about a project.');
  add(home + '#work', 'Work',
    'Index of all seven cases as cards. Only for questions spanning several projects — never to answer about one.');
  add(home + '#studio', 'Studio',
    'How Steve works: strategy through shipped code. For questions about process or working style.');
  add(home + '#contact', 'Contact', 'Email and the roles Steve is open to.');
  add('/pdf/Steve-Jung-Resume.pdf', 'Résumé (PDF)',
    'Full résumé. For questions about career history, dates, or titles.');

  (copy.index && copy.index.cases || []).forEach((c) => {
    const name = c.title || c.label || c.anchor;
    add(home + '#' + c.anchor, name, 'Summary card on the home page — '
      + [c.kicker, c.tagline].filter(Boolean).join(' — '));
  });

  (copy.caseStudy && copy.caseStudy.cases || []).forEach((c) => {
    const name = c.title || c.short || c.anchor;
    add(prefix + '/case-study#' + c.anchor, name + ' (full case study)',
      c.summary || c.short || '');
    // Each banner is a titled section inside that case study.
    (c.banners || []).forEach((b) => {
      if (b.key) {
        add(prefix + '/case-study#' + c.anchor + '-' + b.key,
          b.name || b.group || b.key, b.short || '');
      }
      if (Array.isArray(b.pdf)) {
        add('/pdf/' + b.pdf.join('/'), b.linkLabel || b.name || 'PDF', b.short || '');
      }
      if (b.linkUrl || b.link) {
        add(absolute(b.linkUrl || b.link), b.linkLabel || b.link || b.name,
          'Live: ' + (b.name || ''));
      }
    });
  });

  // Live-project links attached anywhere else in the copy tree.
  walk(copy, (node) => {
    if (node && typeof node === 'object' && (node.linkUrl || node.link)) {
      add(absolute(node.linkUrl || node.link),
        node.linkLabel || node.link || node.title || 'Open',
        node.title || node.name || '');
    }
  });

  return links;
}

function walk(node, fn) {
  fn(node);
  if (Array.isArray(node)) node.forEach((n) => walk(n, fn));
  else if (node && typeof node === 'object') Object.values(node).forEach((n) => walk(n, fn));
}

/** The copy tree flattened to labelled lines — readable by the model, cheap to cache. */
function buildSiteContext(copy) {
  const lines = [];
  const render = (node, trail) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      const text = String(node).trim();
      if (text) lines.push(trail + ': ' + text);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((child, i) => render(child, trail + '[' + i + ']'));
      return;
    }
    if (typeof node === 'object') {
      Object.keys(node).forEach((k) => render(node[k], trail ? trail + '.' + k : k));
    }
  };
  render(copy, '');
  return lines.join('\n');
}

const cache = new Map();
function siteData(locale) {
  if (!cache.has(locale)) {
    const copy = loadCopy(locale);
    cache.set(locale, {
      context: buildSiteContext(copy),
      links: buildLinkCatalog(copy, LOCALES[locale])
    });
  }
  return cache.get(locale);
}

// ---------------------------------------------------------------- prompt

function systemPrompt(locale) {
  const { context, links } = siteData(locale);
  return [
    "You are AI Steve, the assistant on Steve Jung's portfolio site (stevejung.dev).",
    "Steve is a Product Designer and Creative Technologist who plans, designs, builds, and ships —",
    'brand and print design, web development, and AI automation, done in-house without an agency.',
    'Most visitors are recruiters or hiring managers sizing up his work.',
    '',
    'How to answer:',
    "- Use only the site content below. If it does not cover something, say so and point to Steve's contact or résumé rather than guessing.",
    '- Reply in the language the visitor wrote in.',
    '- Speak about Steve in the third person. Never invent employers, dates, metrics, or project names.',
    '',
    'Length — the reply renders in a chat bubble about 240px wide, so length is',
    'the difference between something read and something scrolled past:',
    '- Keep the whole answer under 60 words. Two or three sentences, one idea each.',
    '- Lead with the direct answer. Then give ONE piece of evidence — a number, a stack, or a shipped outcome — and stop.',
    '- Do not inventory. If several projects qualify, name the strongest one and let the link carry the rest.',
    '',
    'Links:',
    '- Attach at most two, and only from the catalog, using each "url" value verbatim.',
    '- If the question is about one project, link that project\'s own case study. Do not answer it with the Work index or the home page — those are for questions that genuinely span several projects, or are about Steve rather than a piece of work.',
    '- Prefer a /case-study# link over a home-page anchor when both cover the same project: the case study is the fuller read.',
    '- Omit links entirely when none genuinely fit.',
    '',
    '=== LINK CATALOG ===',
    links.map((l) => l.url + ' | ' + l.label + (l.about ? ' | ' + l.about : '')).join('\n'),
    '',
    '=== SITE CONTENT ===',
    context
  ].join('\n');
}

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: "The reply, in the visitor's language." },
    links: {
      type: 'array',
      description: 'At most two links, taken verbatim from the catalog. Empty when none fit.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short chip text, 3-5 words, in the visitor\'s language.' },
          url: { type: 'string', description: 'Exact url from the catalog.' }
        },
        required: ['label', 'url'],
        additionalProperties: false
      }
    }
  },
  required: ['answer', 'links'],
  additionalProperties: false
};

// --------------------------------------------------------------- handler

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });
  }

  const body = typeof req.body === 'string' ? safeParse(req.body) : (req.body || {});
  const message = String(body.message || '').trim().slice(0, MAX_MESSAGE_CHARS);
  if (!message) return res.status(400).json({ error: 'message is required' });

  const locale = LOCALES[body.locale] === undefined ? 'en' : body.locale;

  // Only role and text survive from the client; anything else is discarded.
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-MAX_HISTORY_TURNS)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, MAX_MESSAGE_CHARS) }));

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: [{
        type: 'text',
        text: systemPrompt(locale),
        // The catalog and site copy are identical on every request, so this
        // prefix is read from cache rather than re-billed per visitor.
        cache_control: { type: 'ephemeral' }
      }],
      output_config: {
        effort: 'low', // short lookups over supplied context; keeps replies fast
        format: { type: 'json_schema', schema: REPLY_SCHEMA }
      },
      messages: history.concat([{ role: 'user', content: message }])
    });

    if (response.stop_reason === 'refusal') {
      return res.status(200).json({
        reply: "I can't help with that one. Ask me about Steve's work instead.",
        links: []
      });
    }

    const text = (response.content.find((b) => b.type === 'text') || {}).text || '';
    const parsed = safeParse(text);
    if (!parsed || typeof parsed.answer !== 'string') {
      throw new Error('model returned an unreadable payload');
    }

    // The schema constrains the shape, not the values — drop anything whose
    // url is not actually in the catalog so a reply cannot link off-site.
    const allowed = new Set(siteData(locale).links.map((l) => l.url));
    const links = (Array.isArray(parsed.links) ? parsed.links : [])
      .filter((l) => l && allowed.has(l.url))
      .slice(0, 2)
      .map((l) => ({ label: String(l.label || 'Open'), url: l.url }));

    return res.status(200).json({ reply: parsed.answer, links });
  } catch (err) {
    console.error('ai-steve:', err);
    const status = err instanceof Anthropic.RateLimitError ? 429 : 502;
    return res.status(status).json({ error: 'upstream_failed' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

// Exported so the knowledge base and link catalog can be inspected offline —
// `node -e "console.log(require('./api/ai-steve.js').__internals.siteData('en').links)"`
// lists every route the agent is allowed to send a visitor to.
module.exports.__internals = { siteData, systemPrompt, buildLinkCatalog, loadCopy };
