const ALLOWED_TAGS = new Set([
  "A", "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3",
  "H4", "H5", "H6", "HR", "I", "LI", "OL", "P", "PRE", "S", "SPAN",
  "STRONG", "SUB", "SUP", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD",
  "TR", "U", "UL",
]);

export function sanitizeRichHtml(html) {
  if (!html || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  for (const el of [...doc.body.querySelectorAll("*")]) {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      el.replaceWith(...el.childNodes);
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (el.tagName === "A" && name === "href") {
        try {
          const url = new URL(attr.value, location.href);
          if (!["http:", "https:", "mailto:"].includes(url.protocol)) el.removeAttribute(attr.name);
          else el.setAttribute("href", url.href);
        } catch { el.removeAttribute(attr.name); }
      } else if (!["colspan", "rowspan"].includes(name)) {
        el.removeAttribute(attr.name);
      }
    }
  }
  return doc.body.innerHTML.trim();
}

export function tableRowsFromHtml(html) {
  if (!html || typeof DOMParser === "undefined") return [];
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const table = doc.querySelector("table");
  if (!table) return [];
  return [...table.querySelectorAll("tr")].map(row =>
    [...row.querySelectorAll(":scope > th, :scope > td")].map(cell =>
      (cell.innerText || cell.textContent || "").replace(/\s+/g, " ").trim()
    )
  ).filter(row => row.length);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows) {
  return (rows || []).map(row => row.map(csvCell).join(",")).join("\n");
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function rowsToMarkdown(rows) {
  if (!Array.isArray(rows) || !rows.length) return "";
  const width = Math.max(...rows.map(r => r.length));
  const normalized = rows.map(r => Array.from({ length: width }, (_, i) => markdownCell(r[i] || "")));
  const header = normalized[0];
  const divider = Array.from({ length: width }, () => "---");
  return [header, divider, ...normalized.slice(1)].map(row => `| ${row.join(" | ")} |`).join("\n");
}

export function hasMeaningfulFormatting(html) {
  return /<(?:h[1-6]|p|br|strong|b|em|i|u|a|ul|ol|li|blockquote|pre|code|table)\b/i.test(html || "");
}
