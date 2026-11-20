import { rankOf, suitOf, type Card } from './cards';

/** 役の種類（強い順に大きい） */
export const CATEGORY_NAMES = [
  'ハイカード', 'ワンペア', 'ツーペア', 'スリーカード', 'ストレート',
  'フラッシュ', 'フルハウス', 'フォーカード', 'ストレートフラッシュ',
] as const;

export const categoryOf = (score: number) => score >>> 20;

const counts = new Int8Array(13);
const suitCounts = new Int8Array(4);
const suitMasks = new Int32Array(4);

/** ビットマスク（bit r = ランク r）で一番高いストレートの最上位ランク。なければ -1 */
function straightHigh(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    const need = 0b11111 << (top - 4);
    if ((mask & need) === need) return top;
  }
  // A-2-3-4-5（ホイール）
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3;
  return -1;
}

function pack(cat: number, ranks: number[]): number {
  let v = cat << 20;
  for (let i = 0; i < 5; i++) v |= (ranks[i] ?? 0) << (16 - 4 * i);
  return v;
}

function topBits(mask: number, n: number, exclude: number[] = []): number[] {
  const out: number[] = [];
  for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r) && !exclude.includes(r)) out.push(r);
  return out;
}

/** 5〜7枚の中で最強の5枚の強さ（大きいほど強い）。同じ値は引き分け */
export function evaluate(cards: readonly Card[]): number {
  counts.fill(0);
  suitCounts.fill(0);
  suitMasks.fill(0);
  let rankMask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    counts[r]++;
    suitCounts[s]++;
    suitMasks[s] |= 1 << r;
    rankMask |= 1 << r;
  }

  for (let s = 0; s < 4; s++) {
    if (suitCounts[s] >= 5) {
      const sf = straightHigh(suitMasks[s]);
      if (sf >= 0) return pack(8, [sf]);
      return pack(5, topBits(suitMasks[s], 5));
    }
  }

  let quad = -1;
  const trips: number[] = [];
  const pairs: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quad = r;
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
  }
  if (quad >= 0) return pack(7, [quad, ...topBits(rankMask, 1, [quad])]);
  if (trips.length > 0 && (trips.length > 1 || pairs.length > 0)) {
    const t = trips[0];
    const p = trips.length > 1 ? Math.max(trips[1], pairs[0] ?? -1) : pairs[0];
    return pack(6, [t, p]);
  }
  const st = straightHigh(rankMask);
  if (st >= 0) return pack(4, [st]);
  if (trips.length > 0) return pack(3, [trips[0], ...topBits(rankMask, 2, [trips[0]])]);
  if (pairs.length >= 2) return pack(2, [pairs[0], pairs[1], ...topBits(rankMask, 1, [pairs[0], pairs[1]])]);
  if (pairs.length === 1) return pack(1, [pairs[0], ...topBits(rankMask, 3, [pairs[0]])]);
  return pack(0, topBits(rankMask, 5));
}
