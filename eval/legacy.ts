/**
 * The v0 search scorer, kept verbatim in spirit so the eval can show what the
 * rewrite changed: whole-query substring match, else space-separated token
 * overlap, else CJK character-bigram overlap. No IDF, no length
 * normalisation, no fusion.
 */
function normalize(text: string): string {
  return text.toLowerCase();
}

function isMostlyCjk(text: string): boolean {
  const s = text.replace(/\s+/g, '');
  if (s.length < 2) return false;
  let cjk = 0;
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)) cjk += 1;
  }
  return cjk / s.length >= 0.6;
}

export function legacyKeywordScore(query: string, text: string): number {
  if (!text) return 0;
  const q = normalize(query).trim();
  const t = normalize(text);
  if (!q) return 0;
  if (t.includes(q)) return 1;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) return tokens.filter((tok) => t.includes(tok)).length / tokens.length;
  if (isMostlyCjk(q) && q.length >= 2) {
    const s = q.replace(/\s+/g, '');
    const grams: string[] = [];
    for (let i = 0; i < s.length - 1; i += 1) grams.push(s.slice(i, i + 2));
    return Math.min(0.99, grams.filter((g) => t.includes(g)).length / grams.length);
  }
  return 0;
}
