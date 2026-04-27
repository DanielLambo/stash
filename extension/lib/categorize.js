// Smart type detection for clipboard items.
// Returns: { type, label, icon, meta }

const URL_RE = /^https?:\/\/[^\s]+$/i;
const EMAIL_RE = /^[\w.+-]+@[\w-]+\.[\w.-]+$/;
const PHONE_RE = /^\+?[\d\s\-().]{7,}$/;
const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CODE_HINTS = [
  /^\s*(import|export|function|const|let|var|class|def|public|private|if|for|while|return)\b/m,
  /[{};]\s*$/m,
  /=>/,
  /^\s*<[a-zA-Z]/m,
];

export function categorize(item) {
  if (item.kind === "image") {
    return { type: "image", label: "Image", icon: "image" };
  }
  const text = (item.text || "").trim();
  if (!text) return { type: "text", label: "Text", icon: "text" };

  if (URL_RE.test(text)) {
    let host = "";
    try { host = new URL(text).hostname.replace(/^www\./, ""); } catch {}
    return { type: "link", label: "Link", icon: "link", meta: { host } };
  }
  if (EMAIL_RE.test(text)) return { type: "email", label: "Email", icon: "email" };
  if (PHONE_RE.test(text) && /\d{7,}/.test(text.replace(/\D/g, ""))) {
    return { type: "phone", label: "Phone", icon: "phone" };
  }
  if (HEX_RE.test(text)) {
    const hex = text.startsWith("#") ? text : `#${text}`;
    return { type: "color", label: "Color", icon: "color", meta: { hex } };
  }
  const lines = text.split("\n");
  if (lines.length >= 2 && CODE_HINTS.some(re => re.test(text))) {
    return { type: "code", label: "Code", icon: "code", meta: { lines: lines.length } };
  }
  return { type: "text", label: "Text", icon: "text" };
}

export function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
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
