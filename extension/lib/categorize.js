// Smart type detection for clipboard items.
// Returns: { type, label, icon, meta }

const URL_RE = /^https?:\/\/[^\s]+$/i;
const WWW_HOST_RE = /^www\.[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/[^\s]*)?$/i;
const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;
const PHONE_RE = /^\+?[\d\s\-().]{7,}$/;

/** Avoid classifying long numeric IDs / card-like runs as phone numbers. */
function looksLikePhone(text) {
  const t = text.trim();
  const digits = t.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return false;
  if (/^\d+$/.test(t)) {
    if (digits.length > 11) return false;
    return true;
  }
  return PHONE_RE.test(t);
}
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+\s*)?\)$/i;
const HSL_RE = /^hsla?\(\s*(\d{1,3})\s*,\s*(\d{1,3})%\s*,\s*(\d{1,3})%(?:\s*,\s*[\d.]+\s*)?\)$/i;
const CODE_HINTS = [
  /^\s*(import|export|function|const|let|var|class|def|public|private|interface|type|enum|namespace|package|#include|using|module)\b/m,
  /^\s*#!(?:\/usr)?\/bin\//m,
  /[{};]\s*$/m,
  /=>/,
  /^\s*<[a-zA-Z]/m,
  /^\s*```[\w]*\s*$/m,
  /\b(await|async|yield|try|catch|finally|switch|case|break|continue)\b/m,
];
const CODE_FENCE = /^```|```$/m;
const SHEBANG = /^#\!(?:\/usr)?\/bin\//m;

/** Strip trailing punctuation often copied with URLs from chat / docs. */
export function trimUrlSurround(s) {
  return String(s || "").trim().replace(/(?:[.,;:!?)>\]"'»]+|…)+$/gu, "");
}

function rgbTupleToHex(r, g, b) {
  const c = n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function hslToRgb(h, s, l) {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = Math.max(0, Math.min(100, s)) / 100;
  const ln = Math.max(0, Math.min(100, l)) / 100;
  const hue2rgb = (p, q, t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  let r; let g; let b;
  if (sn === 0) {
    r = g = b = ln;
  } else {
    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;
    r = hue2rgb(p, q, hn + 1 / 3);
    g = hue2rgb(p, q, hn);
    b = hue2rgb(p, q, hn - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function tryParseCssColor(text) {
  const t = text.trim();
  let m = t.match(RGB_RE);
  if (m) {
    const r = +m[1], g = +m[2], b = +m[3];
    return { hex: rgbTupleToHex(r, g, b), css: t };
  }
  m = t.match(HSL_RE);
  if (m) {
    const { r, g, b } = hslToRgb(+m[1], +m[2], +m[3]);
    return { hex: rgbTupleToHex(r, g, b), css: t };
  }
  return null;
}

function looksLikeCode(text, lines) {
  if (CODE_FENCE.test(text)) return true;
  if (SHEBANG.test(text)) return true;
  if (lines.length >= 2 && CODE_HINTS.some(re => re.test(text))) return true;
  // Single-line snippets: symbols + length (JSON, SQL-ish, minified JS)
  if (lines.length === 1) {
    const line = lines[0];
    if (/^\s*[\[{]/.test(line) && line.length > 4 && line.length < 1e6) {
      try {
        JSON.parse(line);
        return true;
      } catch { /* not strict JSON */ }
    }
    if (line.length < 24) return false;
    const sym = (line.match(/[{}[\];=<>]|=>|\|\||&&|::|->|\/\/|\/\*|\bSELECT\b|\bINSERT\b/gi) || []).length;
    const alnumRatio = (line.match(/[a-z0-9]/gi) || []).length / Math.max(line.length, 1);
    if (sym >= 4 && alnumRatio > 0.35) return true;
    if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(line) && /[":]/.test(line) && line.length > 20) return true;
  }
  return false;
}

export function categorize(item) {
  if (item.kind === "image") {
    return { type: "image", label: "Image", icon: "image" };
  }
  const text = (item.text || "").trim();
  if (!text) return { type: "text", label: "Text", icon: "text" };

  const urlProbe = trimUrlSurround(text);
  if (URL_RE.test(urlProbe)) {
    let host = "";
    try { host = new URL(urlProbe).hostname.replace(/^www\./, ""); } catch {}
    return { type: "link", label: "Link", icon: "link", meta: { host, canonical: urlProbe } };
  }
  if (WWW_HOST_RE.test(text)) {
    const canonical = `https://${text.replace(/^\/+/, "")}`;
    let host = "";
    try { host = new URL(canonical).hostname.replace(/^www\./, ""); } catch { host = text.split("/")[0].replace(/^www\./, ""); }
    return { type: "link", label: "Link", icon: "link", meta: { host, canonical } };
  }
  if (EMAIL_RE.test(text)) return { type: "email", label: "Email", icon: "email" };
  if (looksLikePhone(text)) {
    return { type: "phone", label: "Phone", icon: "phone" };
  }
  if (HEX_RE.test(text)) {
    let h = text.replace(/^#/, "").toLowerCase();
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    if (h.length === 8) h = h.slice(0, 6);
    const hex = `#${h}`;
    return { type: "color", label: "Color", icon: "color", meta: { hex } };
  }
  const cssColor = tryParseCssColor(text);
  if (cssColor) {
    return { type: "color", label: "Color", icon: "color", meta: cssColor };
  }
  const lines = text.split("\n");
  if (looksLikeCode(text, lines)) {
    return { type: "code", label: "Code", icon: "code", meta: { lines: lines.length } };
  }
  return { type: "text", label: "Text", icon: "text" };
}

export function timeAgo(ts) {
  const deltaSec = Math.floor((Date.now() - ts) / 1000);
  if (deltaSec < 0) return "just now";
  const s = Math.max(1, deltaSec);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function summarize(item, max = 120) {
  if (item.kind === "image") return `Image · ${item.width || "?"}×${item.height || "?"}`;
  const t = (item.text || "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
