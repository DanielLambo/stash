// Sensitive-data detector. Pure functions only — Node-testable.
// Returns { sensitive: bool, kind?: string, confidence: 0..1 }.
//
// Each rule is a small named function. We OR them and report the first
// hit, ranked by confidence. False positives here are a privacy ANNOYANCE
// (item gets encrypted unnecessarily); false negatives are a privacy
// VIOLATION (sensitive item stored plaintext). We err toward false
// positives.

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

// Luhn check for credit-card-shaped strings.
export function luhnValid(digits) {
  const d = String(digits).replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = parseInt(d.charAt(i), 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// Shannon entropy in bits/char — proxy for "looks random".
export function entropy(str) {
  if (!str) return 0;
  const counts = Object.create(null);
  for (const ch of str) counts[ch] = (counts[ch] || 0) + 1;
  const len = str.length;
  let h = 0;
  for (const k in counts) {
    const p = counts[k] / len;
    h -= p * Math.log2(p);
  }
  return h;
}

// ─────────────────────────────────────────────────────────────────
// Patterns
// ─────────────────────────────────────────────────────────────────

const RULES = [
  // Stripe-like split keys
  { kind: "stripe-secret", confidence: 0.99, re: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  { kind: "stripe-public", confidence: 0.6,  re: /\bpk_(?:live|test)_[A-Za-z0-9]{20,}\b/ },

  // GitHub
  { kind: "github-token", confidence: 0.99, re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { kind: "github-token-fine", confidence: 0.99, re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },

  // Google API key (AIza prefix is a strong signal)
  { kind: "google-api-key", confidence: 0.95, re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },

  // Slack tokens
  { kind: "slack-token", confidence: 0.97, re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },

  // OpenAI / Anthropic
  { kind: "openai-key", confidence: 0.97, re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { kind: "anthropic-key", confidence: 0.99, re: /\bsk-ant-[A-Za-z0-9\-_]{30,}\b/ },

  // AWS access keys
  { kind: "aws-access-key", confidence: 0.99, re: /\b(?:AKIA|ASIA|AGPA|AIPA|ANPA|ANVA|AROA)[A-Z0-9]{16}\b/ },

  // SSH / RSA private key block
  { kind: "private-key-block", confidence: 0.99,
    re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----/ },

  // JWT (three base64url segments separated by .)
  { kind: "jwt", confidence: 0.85,
    re: /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\b/ },
];

// ─────────────────────────────────────────────────────────────────
// SSN: avoid matching dates / version numbers / phone-like things.
// US SSN format: NNN-NN-NNNN, with disallowed area numbers (000, 666, 9xx).
// ─────────────────────────────────────────────────────────────────
const SSN_RE = /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/;

// ─────────────────────────────────────────────────────────────────
// Credit card detection: locate digit groups, then Luhn-check.
// ─────────────────────────────────────────────────────────────────
const CC_CANDIDATE = /\b(?:\d[ -]?){13,19}\b/g;

// "Looks like a high-entropy random secret." Defends against generic
// API keys we don't have a prefix for. We require length ≥ 24, mixed
// alphanumerics, no whitespace, and entropy ≥ 3.5 bits/char.
function looksLikeRandomSecret(text) {
  const t = text.trim();
  if (t.length < 24 || t.length > 256) return false;
  if (/\s/.test(t)) return false;
  // Heuristic: must have at least one digit AND at least one alpha,
  // mixed-case is a bonus signal.
  if (!/[A-Za-z]/.test(t) || !/[0-9]/.test(t)) return false;
  if (!/[A-Z]/.test(t) || !/[a-z]/.test(t)) {
    // single-case alphanumerics: only flag if very long (≥ 32) and high-entropy
    if (t.length < 32) return false;
  }
  return entropy(t) >= 3.5;
}

// Password labelled in its surrounding text. We check for keys like
// "password=", "pwd:", etc. We don't want to flag "the password is …" in
// prose, only short k=v shaped lines.
const PWD_LABELLED = /\b(?:password|passwd|pwd|secret|api[_-]?key|token)\s*[:=]\s*["']?([^\s"'`<>]{6,})["']?/i;

// ─────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────

export function detectSensitive(text) {
  if (typeof text !== "string" || !text) return { sensitive: false, confidence: 0 };

  // 1. Named-pattern rules (strongest signals)
  let best = null;
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      if (!best || rule.confidence > best.confidence) best = rule;
    }
  }
  if (best && best.confidence >= 0.85) {
    return { sensitive: true, kind: best.kind, confidence: best.confidence };
  }

  // 2. SSN
  if (SSN_RE.test(text)) {
    return { sensitive: true, kind: "ssn", confidence: 0.92 };
  }

  // 3. Credit card via Luhn check
  const ccMatches = text.match(CC_CANDIDATE);
  if (ccMatches) {
    for (const m of ccMatches) {
      if (luhnValid(m)) {
        return { sensitive: true, kind: "credit-card", confidence: 0.93 };
      }
    }
  }

  // 4. Labelled password / secret in k=v form
  const pw = text.match(PWD_LABELLED);
  if (pw && pw[1] && pw[1].length >= 6) {
    return { sensitive: true, kind: "labelled-secret", confidence: 0.8 };
  }

  // 5. Random-looking secret (fallback)
  if (looksLikeRandomSecret(text)) {
    return { sensitive: true, kind: "high-entropy", confidence: 0.65 };
  }

  // 6. Public key from a named pattern (lower confidence)
  if (best && best.confidence < 0.85) {
    return { sensitive: true, kind: best.kind, confidence: best.confidence };
  }

  return { sensitive: false, confidence: 0 };
}

// Returns a one-line, user-friendly label for the detected kind.
export function describeKind(kind) {
  return ({
    "stripe-secret":      "Stripe secret key",
    "stripe-public":      "Stripe key",
    "github-token":       "GitHub token",
    "github-token-fine":  "GitHub fine-grained PAT",
    "google-api-key":     "Google API key",
    "slack-token":        "Slack token",
    "openai-key":         "OpenAI key",
    "anthropic-key":      "Anthropic key",
    "aws-access-key":     "AWS access key",
    "private-key-block":  "Private key",
    "jwt":                "JWT",
    "ssn":                "SSN",
    "credit-card":        "Credit card",
    "labelled-secret":    "Password / token",
    "high-entropy":       "High-entropy secret",
  })[kind] || "Sensitive";
}
