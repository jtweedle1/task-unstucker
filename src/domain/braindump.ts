// Brain dump to actions, offline version: splits free text into separate task titles.
// The AI version does the same job with better judgement; this is the fallback.

export const BRAIN_DUMP_MAX_ITEMS = 30;
export const BRAIN_DUMP_MAX_CHARS = 4000;

const LEAD_INS =
  /^(?:(?:and|also|then|oh|plus)\s+)?(?:i\s+(?:really\s+)?(?:need|have|ought|want|should|must)\s+(?:to\s+)?|i\s+gotta\s+|need\s+to\s+|have\s+to\s+|gotta\s+|must\s+|should\s+|remember\s+to\s+|don'?t\s+forget\s+to\s+|todo:?\s*|to-do:?\s*)/i;

function clean(raw: string): string {
  let t = raw
    .replace(/^\s*(?:[-*•·–—>]+|\d+[.)]|\[[ xX]?\]|[a-z][.)](?=\s))\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  t = t
    .replace(LEAD_INS, '')
    .replace(/[.!,;:]+$/, '')
    .trim();
  if (t.length > 120) t = `${t.slice(0, 119).trimEnd()}…`;
  return t ? t[0]!.toUpperCase() + t.slice(1) : '';
}

export function splitBrainDump(text: string): string[] {
  const parts = text
    .slice(0, BRAIN_DUMP_MAX_CHARS)
    .split(
      /\r?\n|;|(?<=[.!?])\s+(?=[A-Z])|,\s*(?:and\s+)?(?=(?:i\s+)?(?:need|have|gotta|must|should|remember|call|email|text|buy|pay|book|clean|fix|send|finish|start|reply|write|pick up)\b)/i,
    )
    .map(clean)
    .filter((t) => t.length >= 2);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= BRAIN_DUMP_MAX_ITEMS) break;
  }
  return out;
}
