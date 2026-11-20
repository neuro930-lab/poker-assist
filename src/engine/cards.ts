/**
 * カードは 0〜51 の整数。rank = c >> 2（0 = 2 … 12 = A）、suit = c & 3（0=♠ 1=♥ 2=♦ 3=♣）。
 */
export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'shdc';
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];

export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
export const makeCard = (rank: number, suit: number): Card => (rank << 2) | suit;

const SUIT_ALIASES: Record<string, number> = {
  s: 0, '♠': 0, '♤': 0,
  h: 1, '♥': 1, '♡': 1,
  d: 2, '♦': 2, '♢': 2,
  c: 3, '♣': 3, '♧': 3,
};

/** "As" "10h" "t♦" などを読む。読めなければ null */
export function parseCard(text: string): Card | null {
  const t = text.trim();
  const m = /^(10|[2-9TJQKA])\s*([shdc♠♤♥♡♦♢♣♧])$/i.exec(t);
  if (!m) return null;
  const rankText = m[1] === '10' ? 'T' : m[1].toUpperCase();
  const rank = RANK_CHARS.indexOf(rankText);
  const suit = SUIT_ALIASES[m[2].toLowerCase()];
  if (rank < 0 || suit === undefined) return null;
  return makeCard(rank, suit);
}

/** "AsKd" "As Kd" "A♠ K♦" のような並びを読む（読めない部分は無視） */
export function parseCards(text: string): Card[] {
  const out: Card[] = [];
  const re = /(10|[2-9TJQKA])\s*([shdc♠♤♥♡♦♢♣♧])/gi;
  for (const m of text.matchAll(re)) {
    const c = parseCard(m[0]);
    if (c !== null && !out.includes(c)) out.push(c);
  }
  return out;
}

export function cardToString(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
}

/** 2枚 → 169ハンド名（AKs / AKo / 77） */
export function handClass(a: Card, b: Card): string {
  const ra = rankOf(a);
  const rb = rankOf(b);
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  if (hi === lo) return RANK_CHARS[hi] + RANK_CHARS[lo];
  return RANK_CHARS[hi] + RANK_CHARS[lo] + (suitOf(a) === suitOf(b) ? 's' : 'o');
}

/** 169ハンド名 → 具体的な2枚の組み合わせ（ペア6・スーテッド4・オフスート12） */
export function combosOfClass(hand: string): [Card, Card][] {
  const r1 = RANK_CHARS.indexOf(hand[0]);
  const r2 = RANK_CHARS.indexOf(hand[1]);
  const out: [Card, Card][] = [];
  if (r1 === r2) {
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = s1 + 1; s2 < 4; s2++) out.push([makeCard(r1, s1), makeCard(r2, s2)]);
  } else if (hand[2] === 's') {
    for (let s = 0; s < 4; s++) out.push([makeCard(r1, s), makeCard(r2, s)]);
  } else {
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = 0; s2 < 4; s2++) if (s1 !== s2) out.push([makeCard(r1, s1), makeCard(r2, s2)]);
  }
  return out;
}

export const FULL_DECK: Card[] = Array.from({ length: 52 }, (_, i) => i);
