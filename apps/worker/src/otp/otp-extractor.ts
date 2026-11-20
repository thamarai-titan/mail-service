/**
 * Finds a one-time code in a message (README W5): number or code candidates, scored by how
 * close they are to words such as "code" or "verification". Returns null unless one candidate
 * is clearly a code, since showing a wrong code is worse than showing none.
 */

const KEYWORD =
  /\b(codes?|otp|passcode|pass code|verification|verify|one[- ]time|pin|security|log ?in|sign[- ]?in|confirm(ation)?|2fa|two[- ]factor|authenticat(e|ion|or)|token)\b/gi;

/** Words that make a nearby number a reference rather than a code. */
const REFERENCE_WORD =
  /\b(order|invoice|ref(erence)?|ticket|account|acct|phone|tel|fax|zip|postcode|no\.?|number|#)\s*[:.]?\s*$/i;

/**
 * 4 to 8 digits, 3+3 digits split by a space or dash, or 6 to 8 uppercase letters and digits.
 * The boundaries reject parts of prices, dates, times, decimals, URLs, emails and order numbers.
 */
const CANDIDATE =
  /(?<![\w$€£#.:/@-])(\d{3}[ -]\d{3}|\d{4,8}|[A-Z0-9]{6,8})(?![\w@%]|[.:/,-]\w)/g;

const BEFORE_WINDOW = 80;
const AFTER_WINDOW = 40;
const MIN_SCORE = 3;

interface Candidate {
  code: string;
  score: number;
}

function hasKeyword(text: string): boolean {
  KEYWORD.lastIndex = 0;
  return KEYWORD.test(text);
}

function score(
  text: string,
  raw: string,
  index: number,
  subjectHint: boolean,
): number | null {
  const code = raw.replace(/[ -]/g, '');
  const isDigits = /^\d+$/.test(code);
  // Mixed codes need both a letter and a digit; all-caps words are not codes.
  if (!isDigits && !(/\d/.test(code) && /[A-Z]/.test(code))) return null;

  const before = text.slice(Math.max(0, index - BEFORE_WINDOW), index);
  const after = text.slice(
    index + raw.length,
    index + raw.length + AFTER_WINDOW,
  );

  const keywordBefore = hasKeyword(before);
  // Letter-and-digit codes are only trusted right after a keyword ("login code: K7Q2XP").
  if (!isDigits && !keywordBefore) return null;

  let points = 0;
  if (keywordBefore || hasKeyword(after)) points += 3;
  if (subjectHint) points += 1;
  if (isDigits) points += 1;
  if (isDigits && code.length === 6) points += 1;
  if (isDigits && code.length === 4 && /^(19|20)\d\d$/.test(code)) points -= 3;
  if (REFERENCE_WORD.test(before)) points -= 4;
  return points;
}

export function extractOtp(message: {
  subject: string | null | undefined;
  text: string | null | undefined;
}): string | null {
  const subject = message.subject ?? '';
  const subjectHint = hasKeyword(subject);
  let best: Candidate | null = null;

  for (const text of [subject, message.text ?? '']) {
    for (const match of text.matchAll(CANDIDATE)) {
      const raw = match[1]!;
      const points = score(text, raw, match.index, subjectHint);
      if (points === null || points < MIN_SCORE) continue;
      // Ties keep the earlier candidate: subject first, then top of the body.
      if (!best || points > best.score) {
        best = { code: raw.replace(/[ -]/g, ''), score: points };
      }
    }
  }
  return best?.code ?? null;
}
