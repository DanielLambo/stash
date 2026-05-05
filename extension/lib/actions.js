// Smart actions for clipboard items. Each action is one of two kinds:
//   - "transform": pure (text in → text out). Run in popup, replace the
//     stored item's text and re-copy. Pure-testable in Node.
//   - "side-effect": opens a tab, kicks off OCR, etc. Receives a context
//     object with helpers ({ openTab, toast, copyText, openUrl, item }).
//
// Each action is independent. The popup decides which to render based on
// categorize() type; this file owns the implementation of each.

import { categorize, trimUrlSurround } from "./categorize.js";

// ─────────────────────────────────────────────────────────────────
// URL transforms
// ─────────────────────────────────────────────────────────────────

export function urlToMarkdown(url, label) {
  let host = label;
  if (!host) {
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { host = url; }
  }
  return `[${host}](${url})`;
}

// QR codes are tiny — rendered into a 200x200 canvas via a small embedded
// QR encoder. We use the `qr` algorithm in pure JS (~3 KB) inline so we
// never need a network round-trip or external lib.
export function qrMatrix(text) {
  // Minimal QR Code encoder — Numeric/Alphanumeric/Byte mode auto-detect,
  // ECC level L, version auto-selected. Adapted MIT-style from the
  // public-domain "QR Code generator" by Project Nayuki (compacted).
  return _qr(text);
}

// ─────────────────────────────────────────────────────────────────
// Color conversion
// ─────────────────────────────────────────────────────────────────

export function hexToRgb(hex) {
  let h = String(hex || "").trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map(c => c + c).join("");
  if (h.length === 8) h = h.slice(0, 6); // drop alpha
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex({ r, g, b }) {
  const c = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

export function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// sRGB → OKLCH (Björn Ottosson). Pure function, no external deps.
export function rgbToOklch({ r, g, b }) {
  const lin = c => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lr = lin(r), lg = lin(g), lb = lin(b);
  // OKLab matrix from Ottosson's reference implementation
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  const L  = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const aa = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;
  const C = Math.sqrt(aa * aa + bb * bb);
  let H = (Math.atan2(bb, aa) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L: +L.toFixed(3), C: +C.toFixed(3), H: +H.toFixed(1) };
}

export function colorFormatAll(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const hsl = rgbToHsl(rgb);
  const oklch = rgbToOklch(rgb);
  return {
    hex: rgbToHex(rgb),
    rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    oklch: `oklch(${(oklch.L * 100).toFixed(1)}% ${oklch.C.toFixed(3)} ${oklch.H.toFixed(1)})`,
  };
}

// ─────────────────────────────────────────────────────────────────
// JSON
// ─────────────────────────────────────────────────────────────────

export function jsonFormat(text, indent = 2) {
  const obj = JSON.parse(text);
  return JSON.stringify(obj, null, indent);
}
export function jsonMinify(text) {
  return JSON.stringify(JSON.parse(text));
}
export function isLikelyJson(text) {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  if (!(t.startsWith("{") || t.startsWith("["))) return false;
  try { JSON.parse(t); return true; } catch { return false; }
}

// ─────────────────────────────────────────────────────────────────
// Code language detection (heuristic — keep small).
// ─────────────────────────────────────────────────────────────────

export function detectLanguage(text) {
  if (!text) return null;
  if (isLikelyJson(text)) return "json";
  if (/^\s*<[a-zA-Z!]/.test(text) && /<\/[a-zA-Z]+>/.test(text)) return "html";
  if (/^\s*(?:from|import)\s+\S/.test(text) && /:\s*$/m.test(text)) return "python";
  if (/^\s*def\s+\w+\s*\(/m.test(text)) return "python";
  if (/^\s*(?:async\s+)?function\s+\w+\s*\(|=>\s*\{|^\s*const\s+\S+\s*=/m.test(text)) return "javascript";
  if (/^\s*(?:class|public|private|protected)\s+\w+/m.test(text) && /;\s*$/m.test(text)) return "java";
  if (/^\s*(?:fn|let|impl|use|mod|pub)\s/m.test(text) && /->/m.test(text)) return "rust";
  if (/^\s*package\s+\w+/m.test(text) && /^\s*func\s+\w+\s*\(/m.test(text)) return "go";
  if (/^\s*<\?php/m.test(text)) return "php";
  if (/^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\s/im.test(text)) return "sql";
  if (/^\s*#\s*include\s*</m.test(text)) return "c";
  if (/^\s*\$[a-zA-Z]/m.test(text) && /;\s*$/m.test(text)) return "php";
  if (/^\s*(?:#|\/\/)/.test(text)) return "shell";
  return "plaintext";
}

// Tiny syntax highlighter — token-based, returns HTML string. We
// intentionally support a handful of obvious tokens (keywords, strings,
// numbers, comments) per language; not a full lexer.
export function highlight(text, lang) {
  if (!text) return "";
  const escape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!lang || lang === "plaintext") return escape(text);

  const KEYWORDS = {
    javascript: /\b(?:async|await|break|case|catch|class|const|continue|default|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|null|true|false|undefined)\b/g,
    python:     /\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|None|True|False)\b/g,
    rust:       /\b(?:as|async|await|break|const|continue|crate|dyn|else|enum|extern|false|fn|for|if|impl|in|let|loop|match|mod|move|mut|pub|ref|return|self|Self|static|struct|super|trait|true|type|unsafe|use|where|while)\b/g,
    go:         /\b(?:break|case|chan|const|continue|default|defer|else|fallthrough|for|func|go|goto|if|import|interface|map|package|range|return|select|struct|switch|type|var|nil|true|false)\b/g,
    java:       /\b(?:abstract|assert|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|strictfp|super|switch|synchronized|this|throw|throws|transient|try|void|volatile|while|null|true|false)\b/g,
    c:          /\b(?:auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|inline|int|long|register|restrict|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while)\b/g,
    sql:        /\b(?:SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|AS|AND|OR|NOT|NULL|GROUP|BY|ORDER|LIMIT|OFFSET|HAVING|UNION|VALUES|INTO|SET|RETURNING)\b/gi,
    html:       /(?:&lt;\/?[a-zA-Z][\w:-]*|=)/g,
  };
  const STRING = /(["'`])(?:\\.|(?!\1).)*\1/g;
  const NUMBER = /\b(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/g;
  const COMMENT = /\/\/.*?$|\#.*?$|\/\*[\s\S]*?\*\//gm;

  const tokens = [];
  function add(start, end, cls) { tokens.push({ start, end, cls }); }
  function run(re, cls) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      add(m.index, m.index + m[0].length, cls);
      if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loop
    }
  }
  if (lang === "json") {
    run(STRING, "str"); run(NUMBER, "num");
    text.replace(/\b(?:true|false|null)\b/g, (s, off) => { add(off, off + s.length, "kw"); return s; });
  } else {
    run(COMMENT, "cm"); run(STRING, "str"); run(NUMBER, "num");
    if (KEYWORDS[lang]) run(KEYWORDS[lang], "kw");
  }

  // Resolve overlaps — earlier tokens win (a comment beats a keyword inside it).
  tokens.sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));
  const out = [];
  let cursor = 0;
  for (const tok of tokens) {
    if (tok.start < cursor) continue;
    if (tok.start > cursor) out.push(escape(text.slice(cursor, tok.start)));
    out.push(`<span class="hl-${tok.cls}">${escape(text.slice(tok.start, tok.end))}</span>`);
    cursor = tok.end;
  }
  if (cursor < text.length) out.push(escape(text.slice(cursor)));
  return out.join("");
}

// ─────────────────────────────────────────────────────────────────
// Phone formatting
// ─────────────────────────────────────────────────────────────────

export function phoneToE164(phone, defaultCountry = "1") {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return null;
  // If it already starts with "00", treat as international.
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null; // too short to confidently format
}

// ─────────────────────────────────────────────────────────────────
// Action surface — what the popup queries to render buttons.
// ─────────────────────────────────────────────────────────────────

// Returns an array of action descriptors for the given clipboard item.
// Each descriptor is { id, label, icon?, run(item, ctx) }.
//
// `run` returns one of:
//   - { newText: "..." }   replace stored text + re-copy
//   - { copy: "..." }      copy this string to clipboard (don't store)
//   - { sideEffect: true } no value (the action handled itself)
//   - null / undefined     no-op
//
// ctx provides: openTab(url), toast(msg), copyText(text)
export function actionsFor(item) {
  if (!item) return [];
  const cat = categorize(item);
  switch (cat.type) {
    case "link":  return urlActions(item, cat);
    case "color": return colorActions(item, cat);
    case "code":  return codeActions(item, cat);
    case "email": return emailActions(item, cat);
    case "phone": return phoneActions(item, cat);
    case "image": return imageActions(item, cat);
    case "text":  return textActions(item, cat);
    default:      return [];
  }
}

function urlActions(item, cat) {
  // SAFETY: Stash makes ZERO outgoing third-party network requests.
  // An earlier draft included a "Shorten" action that POSTed to is.gd
  // when the user clicked it; that was the only third-party endpoint
  // anywhere in the extension and it has been removed entirely. All
  // URL actions below operate purely on the local string — no fetch.
  const url = cat.meta?.canonical || trimUrlSurround(item.text);
  return [
    { id: "open",     label: "Open",            run: (_, ctx) => { ctx.openTab(url); return { sideEffect: true }; } },
    { id: "markdown", label: "Copy as Markdown", run: (_, ctx) => ({ copy: urlToMarkdown(url, cat.meta?.host) }) },
    { id: "qr",       label: "QR Code",         run: () => ({ sideEffect: true, render: "qr", value: url }) },
  ];
}

function colorActions(item, cat) {
  const hex = cat.meta?.hex || item.text;
  return [
    { id: "hex",   label: "Copy hex",   run: () => ({ copy: colorFormatAll(hex)?.hex || hex }) },
    { id: "rgb",   label: "Copy RGB",   run: () => ({ copy: colorFormatAll(hex)?.rgb }) },
    { id: "hsl",   label: "Copy HSL",   run: () => ({ copy: colorFormatAll(hex)?.hsl }) },
    { id: "oklch", label: "Copy OKLCH", run: () => ({ copy: colorFormatAll(hex)?.oklch }) },
  ];
}

function codeActions(item) {
  return [
    { id: "lang", label: "Detect language", run: () => ({ sideEffect: true, render: "code", value: { text: item.text, lang: detectLanguage(item.text) } }) },
    {
      id: "json-format",
      label: "Format JSON",
      visible: isLikelyJson(item.text),
      run: () => { try { return { newText: jsonFormat(item.text, 2) }; } catch { return null; } },
    },
    {
      id: "json-minify",
      label: "Minify JSON",
      visible: isLikelyJson(item.text),
      run: () => { try { return { newText: jsonMinify(item.text) }; } catch { return null; } },
    },
  ].filter(a => a.visible !== false);
}

function emailActions(item) {
  return [
    { id: "compose", label: "Compose",     run: (_, ctx) => { ctx.openTab(`mailto:${encodeURIComponent(item.text)}`); return { sideEffect: true }; } },
    { id: "copy",    label: "Copy address", run: () => ({ copy: item.text }) },
  ];
}

function phoneActions(item) {
  const e164 = phoneToE164(item.text);
  return [
    { id: "dial",  label: "Dial",        run: (_, ctx) => { ctx.openTab(`tel:${e164 || item.text.replace(/\D/g, "")}`); return { sideEffect: true }; } },
    { id: "e164",  label: "Format E.164", run: () => ({ newText: e164 || item.text }) },
  ];
}

// Image actions intentionally empty in v1.
//
// Earlier drafts wired up an OCR action via `import("https://cdn.jsdelivr.net/.../tesseract.js")`.
// That is *remote code execution*, which Chrome Web Store policy
// ("Use of Remote Code") explicitly forbids: every line of JavaScript
// must ship inside the extension package. Bundling tesseract.js + WASM
// would add ~12 MB to the package; we'd rather ship a clean v1 and
// add OCR later either bundled or via the optional self-hosted server.
function imageActions(_item) {
  return [];
}

function textActions(_item) {
  // Plain text — no special actions. Hex colors are handled by `color` type.
  return [];
}

// ─────────────────────────────────────────────────────────────────
// QR encoder — minimal, public-domain-derived, ECC level L.
// Returns a 2D boolean array.
// ─────────────────────────────────────────────────────────────────

function _qr(text) {
  // Implementation is a compact port of the public-domain QR generator
  // (Project Nayuki). Supports byte mode + ECC L, version chosen to fit.
  // Trimmed to what we use: a boolean matrix of dark/light modules.
  const data = new TextEncoder().encode(text);

  const ECC_LEVEL = 0; // L
  const NUM_RAW_DATA_MODULES = (v) => {
    let r = (16 * v + 128) * v + 64;
    if (v >= 2) {
      const num = Math.floor(v / 7) + 2;
      r -= (25 * num - 10) * num - 55;
      if (v >= 7) r -= 36;
    }
    return r;
  };
  const NUM_ERR_CORR_CODEWORDS = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NUM_ERR_CORR_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  ];
  const ALIGN_PAT = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
    [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
    [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
    [6, 28, 50, 72, 94], [6, 26, 50, 74, 98], [6, 30, 54, 78, 102],
    [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114],
    [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122],
    [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130],
    [6, 30, 56, 82, 108, 134], [6, 34, 60, 86, 112, 138],
    [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146],
    [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
    [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162],
    [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
  ];

  // Pick smallest version that fits.
  let version = 1;
  for (; version <= 40; version++) {
    const numCodewords = NUM_RAW_DATA_MODULES(version) >> 3;
    const eccCodewords = NUM_ERR_CORR_CODEWORDS[ECC_LEVEL][version] * NUM_ERR_CORR_BLOCKS[ECC_LEVEL][version];
    const dataCapacityBits = (numCodewords - eccCodewords) * 8;
    // Byte mode: 4-bit mode + (8 or 16)-bit length + 8 bits per byte.
    const lengthBits = version < 10 ? 8 : 16;
    const required = 4 + lengthBits + 8 * data.length;
    if (required <= dataCapacityBits) break;
  }
  if (version > 40) throw new Error("QR data too long");

  const numCodewords = NUM_RAW_DATA_MODULES(version) >> 3;
  const eccTotal = NUM_ERR_CORR_CODEWORDS[ECC_LEVEL][version] * NUM_ERR_CORR_BLOCKS[ECC_LEVEL][version];
  const dataCodewordsTotal = numCodewords - eccTotal;
  const lengthBits = version < 10 ? 8 : 16;

  // Build bit stream
  const bits = [];
  const append = (value, n) => { for (let i = n - 1; i >= 0; i--) bits.push((value >> i) & 1); };
  append(0b0100, 4);                  // byte mode
  append(data.length, lengthBits);
  for (const b of data) append(b, 8);
  // terminator
  for (let i = 0; i < 4 && bits.length < dataCodewordsTotal * 8; i++) bits.push(0);
  while (bits.length % 8) bits.push(0);
  // padding bytes
  const PAD = [0xEC, 0x11];
  let pi = 0;
  while (bits.length / 8 < dataCodewordsTotal) { append(PAD[pi & 1], 8); pi++; }

  // Bytes
  const dataBytes = new Uint8Array(dataCodewordsTotal);
  for (let i = 0; i < dataBytes.length; i++) {
    let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j]; dataBytes[i] = v;
  }

  // Reed–Solomon ECC
  const numBlocks = NUM_ERR_CORR_BLOCKS[ECC_LEVEL][version];
  const eccPerBlock = NUM_ERR_CORR_CODEWORDS[ECC_LEVEL][version];
  const shortBlockLen = Math.floor(numCodewords / numBlocks);
  const numLongBlocks = numCodewords % numBlocks;
  const blocks = [];
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const dataLen = shortBlockLen - eccPerBlock + (i < numBlocks - numLongBlocks ? 0 : 1);
    const dat = dataBytes.subarray(k, k + dataLen);
    k += dataLen;
    const ecc = _rsCompute(dat, eccPerBlock);
    blocks.push({ dat, ecc });
  }
  const interleaved = [];
  let maxData = Math.max(...blocks.map(b => b.dat.length));
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.dat.length) interleaved.push(b.dat[i]);
  for (let i = 0; i < eccPerBlock; i++) for (const b of blocks) interleaved.push(b.ecc[i]);

  // Build matrix
  const size = version * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  function setFinder(x, y) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
      reserved[yy][xx] = true;
      const inOuter = dx === 0 || dx === 6 || dy === 0 || dy === 6;
      const inCenter = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      m[yy][xx] = (inOuter && dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6) || inCenter;
    }
  }
  setFinder(0, 0); setFinder(size - 7, 0); setFinder(0, size - 7);

  // Timing patterns
  for (let i = 0; i < size; i++) {
    if (!reserved[6][i]) { reserved[6][i] = true; m[6][i] = i % 2 === 0; }
    if (!reserved[i][6]) { reserved[i][6] = true; m[i][6] = i % 2 === 0; }
  }
  // Dark module
  reserved[size - 8][8] = true; m[size - 8][8] = true;

  // Alignment patterns
  for (const ay of ALIGN_PAT[version]) for (const ax of ALIGN_PAT[version]) {
    if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const x = ax + dx, y = ay + dy;
      reserved[y][x] = true;
      m[y][x] = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
    }
  }

  // Reserve format-info area
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) { reserved[8][i] = true; reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i++) {
    reserved[8][size - 1 - i] = true;
    reserved[size - 1 - i][8] = true;
  }
  if (version >= 7) {
    for (let dy = 0; dy < 6; dy++) for (let dx = 0; dx < 3; dx++) {
      reserved[dy][size - 11 + dx] = true;
      reserved[size - 11 + dx][dy] = true;
    }
  }

  // Place data bits in zigzag, skipping reserved cells.
  let bitIdx = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - v : v;
        if (reserved[y][x]) continue;
        const byte = interleaved[bitIdx >> 3] || 0;
        const bit = (byte >> (7 - (bitIdx & 7))) & 1;
        m[y][x] = bit === 1;
        bitIdx++;
      }
    }
  }

  // Try all 8 masks, pick lowest penalty
  let bestPenalty = Infinity, bestMask = 0, bestMatrix = null;
  for (let mask = 0; mask < 8; mask++) {
    const test = m.map(r => r.slice());
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (reserved[y][x]) continue;
      if (_maskBit(mask, x, y)) test[y][x] = !test[y][x];
    }
    _drawFormatInfo(test, reserved, ECC_LEVEL, mask, size);
    if (version >= 7) _drawVersionInfo(test, reserved, version, size);
    const pen = _penalty(test, size);
    if (pen < bestPenalty) { bestPenalty = pen; bestMask = mask; bestMatrix = test; }
  }

  return { size, modules: bestMatrix };
}

function _rsCompute(data, ecLen) {
  // Build generator polynomial over GF(256), poly 0x11D
  const exp = new Uint8Array(512), log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x; log[x] = i;
    x <<= 1; if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) exp[i] = exp[i - 255];
  function mul(a, b) { return a && b ? exp[log[a] + log[b]] : 0; }

  const gen = new Uint8Array(ecLen + 1); gen[0] = 1;
  for (let i = 0; i < ecLen; i++) {
    const next = new Uint8Array(gen.length);
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= mul(gen[j], 1);
      if (j + 1 < next.length) next[j + 1] ^= mul(gen[j], exp[i]);
    }
    gen.set(next);
  }
  const buf = new Uint8Array(data.length + ecLen);
  buf.set(data);
  for (let i = 0; i < data.length; i++) {
    const factor = buf[i];
    if (factor !== 0) for (let j = 0; j < ecLen; j++) buf[i + 1 + j] ^= mul(gen[j + 1], factor);
  }
  return buf.subarray(data.length);
}

function _maskBit(mask, x, y) {
  switch (mask) {
    case 0: return ((x + y) & 1) === 0;
    case 1: return (y & 1) === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return ((Math.floor(x / 3) + Math.floor(y / 2)) & 1) === 0;
    case 5: return (x * y) % 2 + (x * y) % 3 === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3) & 1) === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3) & 1) === 0;
  }
  return false;
}

function _drawFormatInfo(m, reserved, ecLevel, mask, size) {
  // ECC L→01, M→00, Q→11, H→10. We use L=01.
  const eccBits = [0b01, 0b00, 0b11, 0b10][ecLevel] || 0b01;
  let data = (eccBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  // First copy
  for (let i = 0; i <= 5; i++) m[8][i] = ((bits >> i) & 1) === 1;
  m[8][7] = ((bits >> 6) & 1) === 1;
  m[8][8] = ((bits >> 7) & 1) === 1;
  m[7][8] = ((bits >> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) m[14 - i][8] = ((bits >> i) & 1) === 1;
  // Second copy
  for (let i = 0; i < 8; i++) m[size - 1 - i][8] = ((bits >> i) & 1) === 1;
  for (let i = 8; i < 15; i++) m[8][size - 15 + i] = ((bits >> i) & 1) === 1;
  m[size - 8][8] = true;
}

function _drawVersionInfo(m, reserved, version, size) {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    const v = ((bits >> i) & 1) === 1;
    m[a][b] = v;
    m[b][a] = v;
  }
}

function _penalty(m, size) {
  let p = 0;
  // Rule 1: runs ≥ 5 same-color in a row/col
  for (let y = 0; y < size; y++) {
    let run = 1;
    for (let x = 1; x < size; x++) {
      if (m[y][x] === m[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
      else run = 1;
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 1;
    for (let y = 1; y < size; y++) {
      if (m[y][x] === m[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p++; }
      else run = 1;
    }
  }
  return p;
}
