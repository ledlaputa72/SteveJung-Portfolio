/**
 * AI Steve — the chat widget's answer endpoint.
 *
 * Knowledge comes from i18n/<locale>.js, the same file the pages render from,
 * evaluated here against a stub `window`. That keeps one source of truth: an
 * edit to the site copy changes what the agent knows on the next request, with
 * nothing to regenerate. vercel.json ships i18n/ with this function so the read
 * resolves at runtime.
 *
 * Replies are English-only for now (see PINNED_LOCALE) and carry links only
 * from the catalog built below, so a reply can never invent a route.
 * Structured outputs enforce that shape rather than asking the model to format
 * it by hand. Briefing notes in content/ tell the agent what a recruiter is
 * really asking; they are reference, never a script.
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

/**
 * Korean support is built but parked: every request is answered from the
 * English copy, with English links, in English. Set this to null to go back to
 * following the page's locale — the per-locale knowledge base, link catalog
 * and briefing notes are all still wired up behind it.
 */
const PINNED_LOCALE = 'en';
const MAX_MESSAGE_CHARS = 1000;
const MAX_HISTORY_TURNS = 12;

// A visitor is watching a typing indicator, so failing fast beats retrying:
// the SDK's default two retries with backoff turn a rate-limited workspace
// into a minute-long hang and then an error anyway.
const client = new Anthropic({ maxRetries: 1, timeout: 30000 });

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

/**
 * Briefing notes on what recruiters are really asking and which evidence
 * answers it. Optional on purpose — if the file doesn't make it into the
 * bundle the agent still answers from the site copy, it just loses the
 * routing hints, which is a better failure than a 500.
 */
function loadNotes() {
  const candidates = [
    path.join(__dirname, '..', 'content', 'recruiter-notes.md'),
    path.join(process.cwd(), 'content', 'recruiter-notes.md')
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  return file ? fs.readFileSync(file, 'utf8') : '';
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
  // The catalog is routing data, not content: `about` only has to be enough to
  // tell one destination from another. Full taglines here cost more than the
  // whole site context does.
  const add = (url, label, about) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    let hint = String(about || '').replace(/\s+/g, ' ').trim();
    if (hint.length > 120) hint = hint.slice(0, 117).replace(/[\s,;·—-]+$/, '') + '…';
    links.push({ url, label, about: hint });
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

/**
 * What the agent needs to know, rather than everything the site says.
 *
 * Flattening the whole copy tree sent ~24k tokens per question — case-study
 * body prose, page metadata and dev-only UI strings included — which is both
 * far more than a 60-word answer needs and enough, a few questions in, to run
 * a workspace into its per-minute token limit. Answers come from the headline
 * facts: what each case was, its scale, and its outcome. The long-form prose
 * lives one click away, which is what the links are for.
 */
function buildSiteContext(copy) {
  const out = [];
  const put = (label, value) => {
    if (value == null) return;
    const text = String(value).trim();
    if (text) out.push(label + ': ' + text);
  };
  const list = (label, arr, fn) => {
    (arr || []).forEach((item) => { const v = fn(item); if (v) out.push(label + ': ' + v); });
  };

  const ui = (copy.index && copy.index.ui) || {};
  out.push('## Positioning');
  // Skip the dev* keys — they are debug-panel strings, not anything about Steve.
  ['heroLead', 'heroLeadAccent', 'manifestoTitleL1', 'manifestoTitleL2',
    'manifestoTitleAccent', 'manifestoBody', 'capabilitiesTitleL1',
    'capabilitiesTitleAccent', 'contactTitle', 'contactLead'
  ].forEach((k) => put(k, ui[k]));

  out.push('', '## Skills');
  list('skill', copy.index && copy.index.skills,
    (g) => g.head + ': ' + (g.items || []).join(', '));

  out.push('', '## Cases (home page)');
  (copy.index && copy.index.cases || []).forEach((c) => {
    out.push('');
    put('case ' + c.anchor, [c.num, c.title, c.kicker].filter(Boolean).join(' · '));
    put('  summary', c.tagline);
    put('  facts', (c.meta || []).map((m) => m.k + ' ' + m.v).join(' · '));
    (c.points || []).forEach((p) => put('  point', p));
    put('  live', c.link);
  });

  out.push('', '## Case studies (detail page)');
  (copy.caseStudy && copy.caseStudy.cases || []).forEach((c) => {
    out.push('');
    put('case-study ' + c.anchor, c.title || c.short);
    put('  summary', c.summary);
    put('  facts', (c.meta || []).map((m) => m.label + ' ' + m.value).join(' · '));
    put('  tags', (c.tags || []).join(', '));
    // Section headlines only. Each banner's body is several paragraphs and is
    // what the /case-study# links exist to show.
    list('  section', c.banners, (b) => [b.name, b.short].filter(Boolean).join(' — '));
  });

  return out.join('\n');
}

/**
 * The notes cite routes in their English form. A Korean visitor's catalog only
 * contains /ko paths, so an un-rewritten hint would be dropped by the
 * allowlist and the reply would lose its link. Anchoring on the backtick keeps
 * this to the cited routes and leaves prose — and /pdf paths — alone.
 */
function localizeNotes(text, prefix) {
  if (!prefix || !text) return text;
  return text
    .replace(/`\/case-study#/g, '`' + prefix + '/case-study#')
    .replace(/`\/#/g, '`' + prefix + '#');
}

const cache = new Map();
let rawNotes;
function siteData(locale) {
  if (rawNotes === undefined) rawNotes = loadNotes();
  if (!cache.has(locale)) {
    const copy = loadCopy(locale);
    cache.set(locale, {
      context: buildSiteContext(copy),
      links: buildLinkCatalog(copy, LOCALES[locale]),
      notes: localizeNotes(rawNotes, LOCALES[locale])
    });
  }
  return cache.get(locale);
}

// ---------------------------------------------------------------- prompt

function systemPrompt(locale) {
  const { context, links, notes } = siteData(locale);
  return [
    "You are AI Steve, the assistant on Steve Jung's portfolio site (stevejung.dev).",
    "Steve is a Product Designer and Creative Technologist who plans, designs, builds, and ships —",
    'brand and print design, web development, and AI automation, done in-house without an agency.',
    'Most visitors are recruiters or hiring managers sizing up his work.',
    '',
    'You are not only answering questions. Most visitors are deciding whether',
    'Steve is worth a call, and the reply that earns one is a good answer, not a',
    'pitch. Handle the conversation the way a strong interviewer would: take the',
    'question at its intent, give the evidence that actually bears on it, and',
    'notice when someone has moved from browsing to seriously evaluating. The',
    'briefing notes below describe those signals and when a next step is welcome',
    'rather than pushy — follow that judgement, and when in doubt just answer.',
    '',
    'How to answer:',
    "- Use only the site content and briefing notes below. If they do not cover something, say so plainly — a gap is a fair reason to talk to Steve, and inventing an answer is not.",
    '- When a question could be read more than one way, answer the likeliest reading briefly, then ask the one short question that would let you answer it properly.',
    '- Always answer in English, whatever language the visitor writes in. If they wrote in another language, answer their question in English anyway — do not apologise for the language or refuse.',
    '- Speak about Steve in the third person. Never invent employers, dates, metrics, or project names.',
    '',
    'Shape of a reply — you are opening a conversation, not filing a report. The',
    'text answers enough to be worth reading; the page behind the link is where',
    'the detail lives, and getting the visitor there is the point:',
    '- SIXTY WORDS, HARD. Count them before you answer. Sixty-one is too many; the bubble is 240px wide and anything longer makes the visitor scroll, which is how a good answer goes unread. The richest questions are the ones this catches — the temptation to keep going is the signal to stop.',
    '- Answer the intent of the question first, in your own words.',
    '- Two or three sentences, one idea each.',
    '- Give ONE piece of evidence — a number, a stack, or a shipped outcome — then hand off to the link.',
    '- Close by pointing at what the link holds, naturally and in the sentence rather than as an instruction. "The full build is in the case study" reads well; "click the button below" does not.',
    '- Do not inventory. If several projects qualify, name the strongest one and let the link carry the rest.',
    '- Never try to fit the whole case into the bubble. An answer that needs scrolling has already failed.',
    '- Evidence, a clarifying question, and a next step do not stack. Sixty words holds the answer plus ONE of them — pick whichever the moment calls for and drop the others. Asking a clarifying question means cutting the evidence, not appending the question to it.',
    '- Do not close two replies in a row the same way. If the last reply ended by pointing at the contact section, this one answers and stops — repeating a phrasing turns it into a script, and repeating an ask turns it into a pitch.',
    '',
    'Links — the reply is the invitation, these are where it leads:',
    '- Attach at most two, and only from the catalog, using each "url" value verbatim.',
    '- If the question is about one project, link that project\'s own case study. Do not answer it with the Work index or the home page — those are for questions that genuinely span several projects, or are about Steve rather than a piece of work.',
    '- Prefer a /case-study# link over a home-page anchor when both cover the same project: the case study is the fuller read.',
    '- Omit links entirely when none genuinely fit.',
    '',
    '=== LINK CATALOG ===',
    links.map((l) => l.url + ' | ' + l.label + (l.about ? ' | ' + l.about : '')).join('\n'),
    '',
    // Notes on what a recruiter is really asking and which proof answers it.
    // Deliberately framed as reference: recited notes would make every visitor
    // get the same paragraph, which is worse than no notes at all.
    ...(notes ? [
      '=== BRIEFING NOTES (reference — never a script) ===',
      'Read these for what a question is really after and where to point. They are',
      'not answers and their wording is not yours: compose every reply fresh from',
      'the site content, in your own words. Two visitors asking the same question',
      'should get two differently-worded replies. Where a note and the site content',
      'disagree, the site content wins. A question these notes do not cover is',
      'answered the same way as any other — from the site content.',
      '',
      notes,
      ''
    ] : []),
    '=== SITE CONTENT ===',
    context
  ].join('\n');
}

const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The reply, in English.' },
    links: {
      type: 'array',
      description: 'At most two links, taken verbatim from the catalog. Empty when none fit.',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string', description: 'Short chip text in English, 3-5 words.' },
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

  const locale = PINNED_LOCALE
    || (LOCALES[body.locale] === undefined ? 'en' : body.locale);

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
    // The status and error name are what a failing widget is diagnosed from,
    // so log enough to tell a rate limit from a bad key from a model error.
    console.error('ai-steve:', err && err.name, err && err.status, err && err.message);
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: 'rate_limited' });
    }
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(401).json({ error: 'bad_api_key' });
    }
    return res.status(502).json({ error: 'upstream_failed' });
  }
};

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}

// Exported so the knowledge base and link catalog can be inspected offline —
// `node -e "console.log(require('./api/ai-steve.js').__internals.siteData('en').links)"`
// lists every route the agent is allowed to send a visitor to.
module.exports.__internals = { siteData, systemPrompt, buildLinkCatalog, loadCopy };
