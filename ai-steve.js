/**
 * AI Steve — floating chat widget.
 *
 * Ported 1:1 from the validated prototype in ai-steve-widget-spec.md. The
 * polar radius profiles, Catmull-Rom spline, blend modes and timing constants
 * are the tuned originals — do not "simplify" them.
 *
 * This site has no bundler and no client-side router: support.js (dc-runtime)
 * compiles the <x-dc> block into React at runtime and mounts it into that
 * element, so a widget appended to <body> sits outside the React tree and
 * survives untouched. Loading this file from the <helmet> of each page is the
 * equivalent of the spec's "mount once in app/layout.tsx".
 *
 * Animation state lives in plain closure variables mutated per frame, and the
 * frame writes SVG attributes directly — no per-frame re-render, same as the
 * prototype.
 *
 * send() calls /api/ai-steve, which answers from i18n/<locale>.js — the same
 * copy the pages render — and returns links chosen from a fixed catalog of the
 * site's own routes, so a reply can only ever point somewhere that exists.
 */
(function () {
  'use strict';

  if (window.__aiSteveMounted) return;
  window.__aiSteveMounted = true;

  // ------------------------------------------------------------------ config

  var PRIMARY = '#8B5CF6';   // bright purple
  var SECONDARY = '#CB5CF6'; // same L/S, hue +25deg toward magenta

  var ICON_R = 30;
  var CX = 50;
  var CY = 50;
  var N_BINS = 64; // rendering resolution; profiles below are 48 points

  var SHAPE_MIN_MS = 700;  // per-transition duration, re-randomised every cycle
  var SHAPE_MAX_MS = 1600;
  var DRIFT_MIN_MS = 900;  // position drift retarget, deliberately out of step
  var DRIFT_MAX_MS = 2200;
  var DRIFT_RANGE = 3;     // +-3 units per axis

  var BLINK_MIN_MS = 1800;
  var BLINK_MAX_MS = 5000;
  var BLINK_DUR_MS = 180;
  var WINK_MIN_MS = 4500;
  var WINK_MAX_MS = 10000;
  var WINK_DUR_MS = 420;
  var WINK_CORNER_LIFT = 3.2;

  var HOVER_EASE = 0.15;   // hoverAmt += (target - hoverAmt) * HOVER_EASE
  var HOVER_CIRCLE_R = 0.82;
  var HOVER_SPLIT = 0.05;  // * ICON_R, each blob, opposite directions

  var EYE_RX = 2.1;
  var EYE_RY = 2.1;
  var EYE_DX = 7;
  var EYE_Y = -4;          // relative to the face group origin
  var MOUTH_HALF_W = 7.5;
  var MOUTH_Y0 = 6;
  var MOUTH_DEPTH = 11;
  var INK = '#111111';

  // Silhouettes traced from reference blob artwork: 48 boundary radii (0-1)
  // at evenly spaced angles from 0 (pointing right), clockwise. Not sine
  // approximations — the irregularity is the point.
  var PINK = [0.981,0.986,0.978,0.942,0.879,0.809,0.751,0.711,
              0.688,0.683,0.698,0.745,0.813,0.888,0.95,0.988,
              1.0,0.994,0.977,0.959,0.94,0.924,0.91,0.9,
              0.888,0.88,0.874,0.867,0.864,0.859,0.856,0.854,
              0.854,0.853,0.842,0.825,0.818,0.825,0.847,0.875,
              0.895,0.908,0.918,0.929,0.939,0.951,0.961,0.971];

  var TEAL = [0.975,1.0,0.995,0.981,0.961,0.935,0.908,0.879,
              0.855,0.829,0.807,0.791,0.785,0.782,0.788,0.8,
              0.818,0.838,0.855,0.871,0.881,0.884,0.877,0.868,
              0.858,0.845,0.838,0.838,0.846,0.864,0.888,0.914,
              0.937,0.937,0.916,0.892,0.884,0.879,0.861,0.828,
              0.784,0.734,0.692,0.676,0.684,0.721,0.801,0.901];

  var NAVY = [0.974,0.985,1.0,0.983,0.908,0.802,0.711,0.652,
              0.617,0.606,0.614,0.643,0.693,0.756,0.822,0.882,
              0.932,0.965,0.979,0.978,0.968,0.95,0.932,0.913,
              0.895,0.877,0.862,0.847,0.836,0.828,0.819,0.812,
              0.809,0.797,0.776,0.756,0.749,0.756,0.776,0.81,
              0.842,0.866,0.882,0.896,0.914,0.932,0.952,0.966];

  var SAGE = [0.963,0.938,0.918,0.906,0.897,0.889,0.885,0.883,
              0.884,0.888,0.902,0.922,0.95,0.977,0.995,1.0,
              0.988,0.963,0.932,0.903,0.879,0.862,0.856,0.862,
              0.877,0.898,0.922,0.943,0.961,0.968,0.965,0.954,
              0.939,0.918,0.897,0.882,0.871,0.866,0.866,0.873,
              0.886,0.903,0.924,0.947,0.97,0.986,0.993,0.985];

  // Shapes only — the icon is solid purple, the source palettes are unused.
  var PRESETS = [PINK, TEAL, NAVY, SAGE];

  // Teasers for the hover bubble. Opening the chat used to also drop a canned
  // reply for the teaser's topic into the transcript; that second message said
  // nothing the visitor had asked for, so the chat now opens on the greeting
  // alone and every answer comes from /api/ai-steve.
  var HOVER_TOPICS = [
    { text: 'Hi! Ask me anything about Steve' },
    { text: 'Curious how Steve builds AI tools?' },
    { text: 'Want to see the live projects?' },
    { text: 'I can tell you about the Starllion launch' },
    { text: 'Ask why Steve moved into product design' }
  ];

  var QUICK_CHIPS = [
    'See AI projects',
    'Career history',
    'Why product design?',
    'Ask something'
  ];

  // ------------------------------------------------------------------- math

  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function rand(min, max) { return min + Math.random() * (max - min); }

  function sampleProfile(profile, u) { // u = 0..1 fraction around the circle
    var n = profile.length;
    var pos = u * n;
    var i0 = Math.floor(pos) % n;
    var i1 = (i0 + 1) % n;
    var frac = pos - Math.floor(pos);
    return lerp(profile[i0], profile[i1], frac);
  }

  // Catmull-Rom through N points -> smooth closed path, so no faceting shows.
  function catmullRomPath(pts) {
    var n = pts.length;
    var d = 'M ' + pts[0][0].toFixed(2) + ' ' + pts[0][1].toFixed(2) + ' ';
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += 'C ' + c1x.toFixed(2) + ' ' + c1y.toFixed(2) + ', ' + c2x.toFixed(2) + ' ' + c2y.toFixed(2) +
           ', ' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2) + ' ';
    }
    return d + 'Z';
  }

  // Continuous "cell membrane" tremor, small enough never to read as jitter.
  function tremor(angle, t, phase, freq, amt) {
    return (Math.sin(freq * angle + t * 0.006 + phase) * 0.01
         + Math.sin((freq + 3) * angle - t * 0.009 + phase * 1.7) * 0.006) * amt;
  }

  function buildRadii(profile0, profile1, frac, t, phase, freq, tremorAmt, circleBlend, circleR) {
    var raw = [];
    for (var i = 0; i < N_BINS; i++) {
      var u = i / N_BINS;
      var angle = (Math.PI * 2 * i) / N_BINS;
      var f = lerp(sampleProfile(profile0, u), sampleProfile(profile1, u), frac);
      f += tremor(angle, t, phase, freq, tremorAmt);
      f = lerp(f, circleR, circleBlend); // 0 = shape, 1 = perfect circle (hover)
      raw.push(f);
    }
    // One 3-point wrapping average kills any residual faceting.
    var smoothed = [];
    for (var j = 0; j < N_BINS; j++) {
      var a = raw[(j - 1 + N_BINS) % N_BINS], b = raw[j], c = raw[(j + 1) % N_BINS];
      smoothed.push((a + 2 * b + c) / 4);
    }
    return smoothed;
  }

  function buildPoints(radii, driftX, driftY) {
    var pts = [];
    for (var i = 0; i < radii.length; i++) {
      var angle = (Math.PI * 2 * i) / radii.length;
      var r = ICON_R * radii[i];
      pts.push([CX + driftX + Math.cos(angle) * r, CY + driftY + Math.sin(angle) * r]);
    }
    return pts;
  }

  function pickExcluding(exclude) {
    var opts = [];
    for (var i = 0; i < PRESETS.length; i++) { if (exclude.indexOf(i) === -1) opts.push(i); }
    return opts.length ? opts[Math.floor(Math.random() * opts.length)]
                       : Math.floor(Math.random() * PRESETS.length);
  }

  // -------------------------------------------------------------------- dom

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    applyAttrs(node, attrs);
    appendAll(node, children);
    return node;
  }

  function svgEl(tag, attrs, children) {
    var node = document.createElementNS(SVG_NS, tag);
    applyAttrs(node, attrs);
    appendAll(node, children);
    return node;
  }

  function applyAttrs(node, attrs) {
    if (!attrs) return;
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined) continue;
      if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
  }

  function appendAll(node, children) {
    if (!children) return;
    for (var i = 0; i < children.length; i++) {
      if (children[i]) node.appendChild(children[i]);
    }
  }

  /** The static face used by the panel avatars (40x40 viewBox). */
  function avatarSvg(size) {
    var eyeL = svgEl('ellipse', { cx: 14, cy: 17, rx: 2, ry: 2, fill: INK });
    var eyeR = svgEl('ellipse', { cx: 26, cy: 17, rx: 2, ry: 2, fill: INK });
    var mouth = svgEl('path', {
      d: 'M13 24 Q20 29 27 24', fill: 'none', stroke: INK,
      'stroke-width': 2.2, 'stroke-linecap': 'round'
    });
    var svg = svgEl('svg', {
      viewBox: '0 0 40 40', width: size, height: size, 'aria-hidden': 'true'
    }, [
      svgEl('circle', { cx: 20, cy: 20, r: 20, fill: PRIMARY }),
      eyeL, eyeR, mouth
    ]);
    return { svg: svg, eyeL: eyeL, eyeR: eyeR, mouth: mouth };
  }

  // ------------------------------------------------------------------ style

  var CSS = [
    '#ai-steve{position:fixed;right:24px;bottom:24px;z-index:3000;',
      'font-family:"IBM Plex Sans KR",system-ui,sans-serif;line-height:1.5}',

    /* --- floating icon --- */
    '#ai-steve .ais-icon{position:absolute;right:0;bottom:0;width:72px;height:72px;',
      'padding:0;border:0;background:none;cursor:pointer;isolation:isolate;',
      'opacity:1;transition:opacity .22s ease;-webkit-tap-highlight-color:transparent}',
    '#ai-steve .ais-icon svg{display:block;width:100%;height:100%;overflow:visible}',
    '#ai-steve .ais-icon .ais-blob{mix-blend-mode:screen}',
    '#ai-steve.is-open .ais-icon{opacity:0;pointer-events:none}',

    /* --- hover speech bubble --- */
    /* width:max-content is load-bearing — the bubble is absolutely positioned
       inside a root only as wide as the 72px icon, so without it the shrink-to-fit
       width collapses to a few characters and max-width never applies. The cap
       keeps the longest teaser to about two lines, and yields to the viewport so
       the bubble cannot run off a narrow screen. */
    '#ai-steve .ais-bubble{position:absolute;right:80px;bottom:24px;',
      'width:max-content;max-width:min(215px,calc(100vw - 132px));',
      'padding:9px 13px;border-radius:14px;background:#1e1e1e;',
      'border:1px solid #2c2c2c;color:#EDEAE0;font-size:12.5px;line-height:1.45;',
      'white-space:normal;',
      'opacity:0;transform:translateY(6px);transition:opacity .25s ease,transform .25s ease;',
      'pointer-events:none}',
    /* Tail: a right-angle triangle off the upper part of the right edge, its
       vertical side flush with that edge and the tip reaching down-right into
       the blob's top-left. Two layers — the outer one carries the border
       colour, the inner one sits 1px inside it in the fill colour and overlaps
       the bubble's own border, which is how the 1px outline carries around the
       diagonal without a seam at the join. */
    '#ai-steve .ais-bubble::before,#ai-steve .ais-bubble::after{content:"";',
      'position:absolute;width:0;height:0;border-left-style:solid;',
      'border-top-style:solid;border-top-color:transparent}',
    '#ai-steve .ais-bubble::before{left:calc(100% + 1px);top:11px;',
      'border-left-width:13px;border-top-width:15px;border-left-color:#2c2c2c}',
    '#ai-steve .ais-bubble::after{left:100%;top:12px;',
      'border-left-width:11px;border-top-width:13px;border-left-color:#1e1e1e}',
    '#ai-steve .ais-bubble.is-shown{opacity:1;transform:translateY(0)}',
    '#ai-steve.is-open .ais-bubble{opacity:0}',

    /* --- panel --- */
    '#ai-steve .ais-panel{position:absolute;right:0;bottom:0;width:0;height:0;overflow:hidden;',
      'border-radius:16px;background:#131313;border:1px solid #262626;',
      'transition:width .32s ease,height .32s ease;box-shadow:0 18px 50px rgba(0,0,0,.55)}',
    '#ai-steve.is-open .ais-panel{width:340px;height:560px}',
    '#ai-steve .ais-panel-inner{display:flex;flex-direction:column;width:340px;height:560px}',

    '#ai-steve .ais-head{display:flex;align-items:center;gap:9px;padding:13px 14px;',
      'border-bottom:1px solid #232323;flex:0 0 auto}',
    '#ai-steve .ais-head-txt{flex:1 1 auto;min-width:0}',
    '#ai-steve .ais-head-name{color:#EDEAE0;font-size:13.5px;font-weight:500}',
    '#ai-steve .ais-head-sub{color:#C6D94D;font-size:11px}',
    '#ai-steve .ais-close{flex:0 0 auto;width:26px;height:26px;border:0;border-radius:7px;',
      'background:none;color:#888;font-size:17px;line-height:1;cursor:pointer}',
    '#ai-steve .ais-close:hover{background:#1e1e1e;color:#EDEAE0}',

    '#ai-steve .ais-msgs{flex:1 1 auto;overflow-y:auto;display:flex;flex-direction:column;',
      'gap:12px;padding:14px}',
    '#ai-steve .ais-msgs::-webkit-scrollbar{width:6px}',
    '#ai-steve .ais-msgs::-webkit-scrollbar-thumb{background:#2c2c2c;border-radius:3px}',

    '#ai-steve .ais-ai{display:flex;gap:8px;align-items:flex-start}',
    '#ai-steve .ais-ai-body{display:flex;flex-direction:column;gap:7px;align-items:flex-start;',
      'max-width:238px}',
    '#ai-steve .ais-ai-txt{padding:9px 12px;border-radius:4px 14px 14px 14px;background:#1e1e1e;',
      'color:#EDEAE0;font-size:13px;white-space:pre-wrap}',
    '#ai-steve .ais-user{align-self:flex-end;max-width:250px;padding:9px 12px;',
      'border-radius:14px 4px 14px 14px;background:#8B5CF6;color:#fff;font-size:13px;',
      'white-space:pre-wrap}',

    '#ai-steve .ais-links{display:flex;flex-wrap:wrap;gap:6px}',
    '#ai-steve .ais-link{display:inline-block;padding:6px 11px;border-radius:999px;',
      'background:#24261a;border:1px solid #3a3d24;color:#C6D94D;font-size:11.5px;',
      'text-decoration:none}',
    '#ai-steve .ais-link:hover{background:#2b2e1e}',

    '#ai-steve .ais-typing{display:flex;gap:4px;padding:12px}',
    '#ai-steve .ais-typing i{width:5px;height:5px;border-radius:50%;background:#888;',
      'animation:ais-blink 1.2s infinite}',
    '#ai-steve .ais-typing i:nth-child(2){animation-delay:.2s}',
    '#ai-steve .ais-typing i:nth-child(3){animation-delay:.4s}',
    '@keyframes ais-blink{0%,60%,100%{opacity:.25}30%{opacity:1}}',

    /* Chips sat at #1c1c1c against #1e1e1e bubbles, so a tappable option and a
       thing the agent said were the same dark slab. They now sit well above the
       bubbles in lightness, which is what separates a control from a message.
       Deliberately not olive: that colour means "this takes you somewhere" on
       the link chips, and two olive pills doing different jobs would just move
       the confusion rather than fix it. */
    '#ai-steve .ais-chips{display:flex;flex-wrap:wrap;gap:7px;padding-left:36px}',
    '#ai-steve .ais-chip{padding:6px 13px;border-radius:999px;background:#343434;',
      'border:1px solid #4d4d4d;color:#EDEAE0;font-size:11.5px;cursor:pointer;',
      'font-family:inherit}',
    '#ai-steve .ais-chip:hover{background:#404040;border-color:#C6D94D;color:#C6D94D}',

    '#ai-steve .ais-inputrow{flex:0 0 auto;display:flex;align-items:center;gap:8px;',
      'padding:11px 12px;border-top:1px solid #232323}',
    '#ai-steve .ais-input{flex:1 1 auto;min-width:0;padding:9px 14px;border-radius:999px;',
      'background:#1c1c1c;border:1px solid #2c2c2c;color:#EDEAE0;font-size:13px;',
      'font-family:inherit;outline:none}',
    '#ai-steve .ais-input::placeholder{color:#888}',
    '#ai-steve .ais-input:focus{border-color:#C6D94D}',
    '#ai-steve .ais-send{flex:0 0 auto;width:34px;height:34px;border:0;border-radius:50%;',
      'background:#C6D94D;color:#131313;cursor:pointer;display:flex;align-items:center;',
      'justify-content:center}',
    '#ai-steve .ais-send:disabled{opacity:.45;cursor:default}',
    /* Stop state: reads as an interruption rather than the accent-coloured
       "go", and stays fully live so the answer is always escapable. */
    '#ai-steve .ais-send.is-stop{background:#2c2c2c;color:#EDEAE0}',
    '#ai-steve .ais-send.is-stop:hover{background:#3a3a3a}'
  ].join('');

  // ------------------------------------------------------------------ build

  var root = el('div', { id: 'ai-steve' });

  var bubble = el('div', { class: 'ais-bubble' });

  var blobA = svgEl('path', { class: 'ais-blob', fill: PRIMARY });
  var blobB = svgEl('path', { class: 'ais-blob', fill: SECONDARY });
  var eyeL = svgEl('ellipse', { cx: -EYE_DX, cy: EYE_Y, rx: EYE_RX, ry: EYE_RY, fill: INK });
  var eyeR = svgEl('ellipse', { cx: EYE_DX, cy: EYE_Y, rx: EYE_RX, ry: EYE_RY, fill: INK });
  var mouth = svgEl('path', {
    fill: 'none', stroke: INK, 'stroke-width': 2.2, 'stroke-linecap': 'round'
  });
  var faceG = svgEl('g', null, [eyeL, eyeR, mouth]);

  var iconBtn = el('button', {
    class: 'ais-icon', type: 'button', 'aria-label': 'Open the AI Steve chat'
  }, [
    svgEl('svg', { viewBox: '0 0 100 100' }, [
      svgEl('g', { style: 'isolation:isolate' }, [blobA, blobB]),
      faceG
    ])
  ]);

  var msgsEl = el('div', { class: 'ais-msgs' });
  var inputEl = el('input', {
    class: 'ais-input', type: 'text', placeholder: 'Ask about Steve…',
    'aria-label': 'Message AI Steve', autocomplete: 'off'
  });
  var sendArrow = svgEl('svg', { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': 'true' }, [
    svgEl('path', {
      d: 'M5 12h13M12 5l7 7-7 7', fill: 'none', stroke: 'currentColor',
      'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    })
  ]);
  // Shown while an answer is in flight — the same button stops the request
  // rather than going dead, so a slow reply is always escapable.
  var stopSquare = svgEl('svg', { viewBox: '0 0 24 24', width: 15, height: 15, 'aria-hidden': 'true' }, [
    svgEl('rect', { x: 7, y: 7, width: 10, height: 10, rx: 1.5, fill: 'currentColor' })
  ]);
  var sendBtn = el('button', { class: 'ais-send', type: 'button', 'aria-label': 'Send' }, [sendArrow]);
  var closeBtn = el('button', {
    class: 'ais-close', type: 'button', 'aria-label': 'Close the chat', text: '×'
  });

  var headAvatar = avatarSvg(22);
  var panel = el('div', { class: 'ais-panel', role: 'dialog', 'aria-label': 'AI Steve' }, [
    el('div', { class: 'ais-panel-inner' }, [
      el('div', { class: 'ais-head' }, [
        headAvatar.svg,
        el('div', { class: 'ais-head-txt' }, [
          el('div', { class: 'ais-head-name', text: 'AI Steve' }),
          el('div', { class: 'ais-head-sub', text: 'Ask me about Steve’s work' })
        ]),
        closeBtn
      ]),
      msgsEl,
      el('div', { class: 'ais-inputrow' }, [inputEl, sendBtn])
    ])
  ]);

  appendAll(root, [bubble, iconBtn, panel]);

  function mount() {
    document.head.appendChild(el('style', { text: CSS }));
    document.body.appendChild(root);
    requestAnimationFrame(tick);
  }

  // ------------------------------------------------------------ icon state

  function makeBlob(phase, freq) {
    return {
      from: 0, to: 0, start: 0, dur: rand(SHAPE_MIN_MS, SHAPE_MAX_MS),
      dx: 0, dy: 0, fromX: 0, fromY: 0, toX: 0, toY: 0,
      driftStart: 0, driftDur: rand(DRIFT_MIN_MS, DRIFT_MAX_MS),
      phase: phase, freq: freq
    };
  }

  var A = makeBlob(0, 3);            // primary: picks freely
  var B = makeBlob(Math.PI * 0.7, 4); // secondary: never matches A
  A.to = Math.floor(Math.random() * PRESETS.length);
  A.from = A.to;
  B.to = pickExcluding([A.to]);
  B.from = B.to;

  var hoverAmt = 0;
  var hoverTarget = 0;
  var chatOpen = false;

  var blinkAt = rand(BLINK_MIN_MS, BLINK_MAX_MS);
  var blinkStart = -1;
  var winkAt = rand(WINK_MIN_MS, WINK_MAX_MS);
  var winkStart = -1;
  var winkSide = 1; // +1 right eye, -1 left eye

  function stepShape(blob, now, otherTo) {
    if (blob.start === 0) blob.start = now;
    var p = (now - blob.start) / blob.dur;
    if (p >= 1) {
      blob.from = blob.to;
      // Never repeat the current shape, and never match the other blob's.
      blob.to = pickExcluding(otherTo === null ? [blob.from] : [blob.from, otherTo]);
      blob.start = now;
      blob.dur = rand(SHAPE_MIN_MS, SHAPE_MAX_MS);
      p = 0;
    }
    return easeInOut(p);
  }

  function stepDrift(blob, now, damp) {
    if (blob.driftStart === 0) blob.driftStart = now;
    var p = (now - blob.driftStart) / blob.driftDur;
    if (p >= 1) {
      blob.fromX = blob.toX; blob.fromY = blob.toY;
      blob.toX = rand(-DRIFT_RANGE, DRIFT_RANGE);
      blob.toY = rand(-DRIFT_RANGE, DRIFT_RANGE);
      blob.driftStart = now;
      blob.driftDur = rand(DRIFT_MIN_MS, DRIFT_MAX_MS);
      p = 0;
    }
    var e = easeInOut(p);
    blob.dx = lerp(blob.fromX, blob.toX, e) * damp;
    blob.dy = lerp(blob.fromY, blob.toY, e) * damp;
  }

  function tick(now) {
    requestAnimationFrame(tick);

    hoverAmt += (hoverTarget - hoverAmt) * HOVER_EASE;

    // The icon is hidden while the panel is open, so there is nothing to draw.
    // (Stopping the rAF call itself is listed under "Next steps".)
    if (chatOpen) return;

    var driftDamp = 1 - hoverAmt * 0.6;
    var tremorAmt = 1 - hoverAmt;
    var split = ICON_R * HOVER_SPLIT * hoverAmt;

    var fa = stepShape(A, now, null);
    var fb = stepShape(B, now, A.to);
    stepDrift(A, now, driftDamp);
    stepDrift(B, now, driftDamp);

    var ra = buildRadii(PRESETS[A.from], PRESETS[A.to], fa, now, A.phase, A.freq,
                        tremorAmt, hoverAmt, HOVER_CIRCLE_R);
    var rb = buildRadii(PRESETS[B.from], PRESETS[B.to], fb, now, B.phase, B.freq,
                        tremorAmt, hoverAmt, HOVER_CIRCLE_R);

    blobA.setAttribute('d', catmullRomPath(buildPoints(ra, A.dx - split, A.dy)));
    blobB.setAttribute('d', catmullRomPath(buildPoints(rb, B.dx + split, B.dy)));

    drawFace(now);
  }

  function drawFace(now) {
    // Blink: both eyes, 180ms triangle close/open.
    if (blinkStart < 0 && now >= blinkAt) blinkStart = now;
    var blink = 0;
    if (blinkStart >= 0) {
      var bp = (now - blinkStart) / BLINK_DUR_MS;
      if (bp >= 1) {
        blinkStart = -1;
        blinkAt = now + rand(BLINK_MIN_MS, BLINK_MAX_MS);
      } else {
        blink = 1 - Math.abs(bp * 2 - 1); // triangle 0 -> 1 -> 0
      }
    }

    // Wink: one eye, 420ms sine bell, driving the same-side mouth corner.
    if (winkStart < 0 && now >= winkAt) {
      winkStart = now;
      winkSide = Math.random() < 0.5 ? -1 : 1;
    }
    var wink = 0;
    if (winkStart >= 0) {
      var wp = (now - winkStart) / WINK_DUR_MS;
      if (wp >= 1) {
        winkStart = -1;
        winkAt = now + rand(WINK_MIN_MS, WINK_MAX_MS);
      } else {
        wink = Math.sin(wp * Math.PI); // 0 -> 1 -> 0
      }
    }

    var baseRx = lerp(EYE_RX, 2.5, hoverAmt);
    var baseRy = EYE_RY * lerp(1, 1.08, hoverAmt);
    var shut = 0.08; // a closed eye keeps a sliver of ry, never hits zero

    var closeL = Math.max(blink, winkSide < 0 ? wink : 0);
    var closeR = Math.max(blink, winkSide > 0 ? wink : 0);

    eyeL.setAttribute('rx', baseRx.toFixed(2));
    eyeR.setAttribute('rx', baseRx.toFixed(2));
    eyeL.setAttribute('ry', (baseRy * lerp(1, shut, closeL)).toFixed(2));
    eyeR.setAttribute('ry', (baseRy * lerp(1, shut, closeR)).toFixed(2));

    // Idle "breathing": width, depth and vertical position each drift on their
    // own slow, differently phased sine. Subtle — this is not talking.
    var halfW = MOUTH_HALF_W * (1 + Math.sin(now * 0.00062) * 0.06) * lerp(1, 1.15, hoverAmt);
    var y0 = MOUTH_Y0 + Math.sin(now * 0.00041 + 1.9) * 0.35;
    var depth = (MOUTH_DEPTH + Math.sin(now * 0.00053 + 3.4) * 0.6) * lerp(1, 1.2, hoverAmt);

    // The winking side's corner lifts on the same 0->1->0 envelope as the eye.
    var liftL = winkSide < 0 ? wink * WINK_CORNER_LIFT : 0;
    var liftR = winkSide > 0 ? wink * WINK_CORNER_LIFT : 0;

    mouth.setAttribute('d',
      'M ' + (-halfW).toFixed(2) + ' ' + (y0 - liftL).toFixed(2) +
      ' Q 0 ' + depth.toFixed(2) + ' ' + halfW.toFixed(2) + ' ' + (y0 - liftR).toFixed(2));

    // The face rides the blobs' average motion, plus a slower bob of its own.
    var fx = (A.dx + B.dx) / 2 + Math.sin(now * 0.00037) * 0.7;
    var fy = (A.dy + B.dy) / 2 + Math.sin(now * 0.00029 + 2.1) * 0.7;
    var rot = Math.sin(now * 0.00023 + 0.8) * 1.6;
    faceG.setAttribute('transform',
      'translate(' + (CX + fx).toFixed(2) + ' ' + (CY + fy).toFixed(2) + ') rotate(' + rot.toFixed(2) + ')');
  }

  // ------------------------------------------------------ hover + bubble

  var lastTopicIdx = -1;

  function onEnter() {
    hoverTarget = 1;
    if (chatOpen) return;
    var i = Math.floor(Math.random() * HOVER_TOPICS.length);
    if (HOVER_TOPICS.length > 1) {
      while (i === lastTopicIdx) i = Math.floor(Math.random() * HOVER_TOPICS.length);
    }
    lastTopicIdx = i;
    bubble.textContent = HOVER_TOPICS[i].text;
    bubble.classList.add('is-shown');
  }

  function onLeave() {
    hoverTarget = 0;
    bubble.classList.remove('is-shown');
  }

  iconBtn.addEventListener('mouseenter', onEnter);
  iconBtn.addEventListener('mouseleave', onLeave);
  iconBtn.addEventListener('focus', onEnter);
  iconBtn.addEventListener('blur', onLeave);

  // ------------------------------------------------------------ chat panel

  var greetingPlayed = false;
  var chatStarted = false;

  function scrollDown() { msgsEl.scrollTop = msgsEl.scrollHeight; }

  /**
   * An AI row: avatar + bubble, with link chips underneath. `links` is an
   * array of { label, url }; a same-origin url opens in this tab so the
   * visitor keeps the open chat, an external one opens in a new tab.
   */
  function addAi(text, links, animatable) {
    var avatar = avatarSvg(26);
    var body = el('div', { class: 'ais-ai-body' }, [
      el('div', { class: 'ais-ai-txt', text: text })
    ]);
    var list = links || [];
    if (list.length) {
      body.appendChild(el('div', { class: 'ais-links' }, list.map(function (l) {
        var external = /^https?:\/\//.test(l.url);
        var attrs = { class: 'ais-link', href: l.url, text: l.label };
        if (external) { attrs.target = '_blank'; attrs.rel = 'noopener noreferrer'; }
        return el('a', attrs);
      })));
    }
    msgsEl.appendChild(el('div', { class: 'ais-ai' }, [avatar.svg, body]));
    scrollDown();
    return animatable ? avatar : null;
  }

  /** Bouncing dots while /api/ai-steve is answering. Returns a remover. */
  function addTyping() {
    var row = el('div', { class: 'ais-ai' }, [
      avatarSvg(26).svg,
      el('div', { class: 'ais-ai-txt ais-typing' },
        [el('i'), el('i'), el('i')])
    ]);
    msgsEl.appendChild(row);
    scrollDown();
    return function () { if (row.parentNode) row.parentNode.removeChild(row); };
  }

  function addUser(text) {
    msgsEl.appendChild(el('div', { class: 'ais-user', text: text }));
    scrollDown();
  }

  var chipRow = null;
  function addChips() {
    var kids = QUICK_CHIPS.map(function (label) {
      var b = el('button', { class: 'ais-chip', type: 'button', text: label });
      b.addEventListener('click', function () {
        removeChips();
        send(label);
      });
      return b;
    });
    chipRow = el('div', { class: 'ais-chips' }, kids);
    msgsEl.appendChild(chipRow);
    scrollDown();
  }

  function removeChips() {
    if (chipRow && chipRow.parentNode) chipRow.parentNode.removeChild(chipRow);
    chipRow = null;
  }

  /**
   * One wink + mouth-corner lift, exactly once per session, on the greeting
   * avatar only. Every other avatar in the panel stays static.
   */
  function playGreetingExpressionOnce(eyeR2El, mouthEl) {
    var start = performance.now();
    var DUR = 420;
    function frame(now) {
      var p = Math.min(1, (now - start) / DUR);
      var closeAmt = Math.sin(p * Math.PI); // 0 -> 1 -> 0
      eyeR2El.setAttribute('ry', (2 - closeAmt * 1.85).toFixed(2));
      var lift = closeAmt;
      mouthEl.setAttribute('d',
        'M 13 ' + (24 - lift * 2.4).toFixed(2) + ' Q 20 ' + (29 - lift * 1.2).toFixed(2) + ' 27 24');
      if (p < 1) requestAnimationFrame(frame);
      else { eyeR2El.setAttribute('ry', '2'); mouthEl.setAttribute('d', 'M13 24 Q20 29 27 24'); }
    }
    requestAnimationFrame(frame);
  }

  function openChat() {
    if (chatOpen) return;
    chatOpen = true;
    root.classList.add('is-open');
    bubble.classList.remove('is-shown');

    if (!chatStarted) {
      chatStarted = true;
      var greetingText =
        "Hi, I'm AI Steve. Ask me about Steve's work, projects, or how he got here.";
      var greeting = addAi(greetingText, null, true);
      remember('assistant', greetingText);
      addChips();

      if (!greetingPlayed && greeting) {
        greetingPlayed = true;
        setTimeout(function () {
          playGreetingExpressionOnce(greeting.eyeR, greeting.mouth);
        }, 380); // just after the panel finishes expanding
      }
    }

    setTimeout(function () { inputEl.focus(); }, 340);
    // Bound on the next tick so the click that opened the panel doesn't
    // immediately close it again.
    setTimeout(function () {
      if (chatOpen) document.addEventListener('pointerdown', onOutsidePointer);
    }, 0);
  }

  /** A press anywhere outside the widget dismisses the panel. */
  function onOutsidePointer(e) {
    if (!root.contains(e.target)) closeChat();
  }

  function closeChat() {
    if (!chatOpen) return;
    chatOpen = false;
    root.classList.remove('is-open');
    hoverTarget = 0;
    document.removeEventListener('pointerdown', onOutsidePointer);
  }

  /**
   * Conversation so far, sent with each turn so follow-ups ("what about the
   * second one?") resolve. The route caps and re-validates this; the cap here
   * just keeps the request small.
   */
  var history = [];
  function remember(role, content) {
    history.push({ role: role, content: content });
    if (history.length > 12) history = history.slice(-12);
  }

  /**
   * Ask /api/ai-steve. The route answers from the site's own copy and returns
   * links drawn from a fixed catalog, so a reply can only point at real pages.
   */
  var inFlight = null;     // AbortController for the answer being waited on
  var stoppedByUser = false;

  /** Swaps the arrow for a stop square; the button stays live either way. */
  function setSending(sending) {
    sendBtn.replaceChildren(sending ? stopSquare : sendArrow);
    sendBtn.setAttribute('aria-label', sending ? 'Stop generating' : 'Send');
    sendBtn.classList.toggle('is-stop', sending);
  }

  /** Abandon the answer in flight and hand the input straight back. */
  function stopSending() {
    if (!inFlight) return;
    stoppedByUser = true;
    inFlight.abort();
  }

  function send(text) {
    var msg = String(text || '').trim();
    if (!msg || inFlight) return;
    removeChips();
    addUser(msg);
    inputEl.value = '';

    var sent = history.slice();
    remember('user', msg);
    var stopTyping = addTyping();

    // A request that never settles would otherwise spin the dots forever with
    // no way out, so it is bounded and cancellable.
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    inFlight = controller;
    stoppedByUser = false;
    setSending(true);
    var timer = setTimeout(function () { if (controller) controller.abort(); }, 45000);

    fetch('/api/ai-steve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        history: sent,
        locale: window.SITE_LOCALE || 'en'
      }),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        if (!res.ok) {
          var err = new Error('HTTP ' + res.status);
          err.status = res.status;
          return res.text().then(function (body) {
            err.body = body.slice(0, 300);
            throw err;
          }, function () { throw err; });
        }
        return res.json();
      })
      .then(function (data) {
        stopTyping();
        var reply = data && data.reply ? data.reply : "Sorry, I didn't catch that.";
        addAi(reply, data && data.links, false);
        remember('assistant', reply);
      })
      .catch(function (err) {
        stopTyping();
        history.pop(); // drop the turn that never got an answer
        if (stoppedByUser) {
          // Their own doing — an apology would be noise. Put the question back
          // so it can be edited and sent again.
          inputEl.value = msg;
          return;
        }
        // A visitor gets one friendly line either way, but the two failures
        // have different causes and the console says which: a status means the
        // route answered and refused, no status means nothing came back at all.
        var timedOut = err && err.name === 'AbortError';
        if (window.console && console.error) {
          console.error('[ai-steve] request failed',
            timedOut ? '(timed out after 45s)' : ('status ' + ((err && err.status) || 'none')),
            (err && err.body) || (err && err.message) || err);
        }
        addAi(
          timedOut
            ? "That took too long. Try again, or reach Steve directly and he’ll answer himself."
            : "Something went wrong on my end. Try again in a moment, or reach Steve directly.",
          [{ label: "Steve's LinkedIn ↗", url: 'https://www.linkedin.com/in/stevejung-dev' }],
          false
        );
      })
      .then(function () {
        clearTimeout(timer);
        inFlight = null;
        setSending(false);
        inputEl.focus();
      });
  }

  iconBtn.addEventListener('click', openChat);
  closeBtn.addEventListener('click', closeChat);
  sendBtn.addEventListener('click', function () {
    if (inFlight) stopSending();
    else send(inputEl.value);
  });
  inputEl.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); send(inputEl.value); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && chatOpen) closeChat();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
