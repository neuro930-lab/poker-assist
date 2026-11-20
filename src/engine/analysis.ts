import { RANK_CHARS, rankOf, suitOf, type Card } from './cards';
import { CATEGORY_NAMES, categoryOf, evaluate } from './evaluator';

const RANK_JA = (r: number) => RANK_CHARS[r];

export interface MadeHand {
  category: number;
  /** 「トップペア（キッカーK）」「セット」など */
  label: string;
  /** 0〜1 のおおまかな強さ（ナッツに近いほど1） */
  strength: number;
}

export interface Draws {
  flushDraw: boolean;
  nutFlushDraw: boolean;
  oesd: boolean;
  gutshot: boolean;
  backdoorFlush: boolean;
  /** 改善するカードの枚数（重複なし・概算） */
  outs: number;
  labels: string[];
}

export interface Texture {
  paired: boolean;
  /** 同じスートの最大枚数 */
  maxSuit: number;
  /** 0（ドライ）〜 1（ウェット） */
  wetness: number;
  label: string;
}

function straightPossibleRanks(mask: number): number[] {
  // 1枚加えるとストレートになるランク（mask はランクのビット集合、A は 12 と -1 の両方として扱う）
  const out: number[] = [];
  for (let r = 0; r < 13; r++) {
    if (mask & (1 << r)) continue;
    const m = mask | (1 << r);
    if (hasStraight(m)) out.push(r);
  }
  return out;
}

function hasStraight(mask: number): boolean {
  for (let top = 12; top >= 4; top--) {
    const need = 0b11111 << (top - 4);
    if ((mask & need) === need) return true;
  }
  return (mask & 0b1000000001111) === 0b1000000001111;
}

const maskOf = (cards: readonly Card[]) => cards.reduce((m, c) => m | (1 << rankOf(c)), 0);

export function analyzeMadeHand(hero: readonly [Card, Card], board: readonly Card[]): MadeHand {
  const all = [...hero, ...board];
  const score = evaluate(all);
  const cat = categoryOf(score);
  if (board.length === 0) {
    const pair = rankOf(hero[0]) === rankOf(hero[1]);
    return { category: pair ? 1 : 0, label: pair ? 'ポケットペア' : 'ハイカード', strength: pair ? 0.5 : 0.3 };
  }
  const boardScore = evaluate(board.length >= 5 ? board : [...board]);
  const boardCat = board.length >= 5 ? categoryOf(boardScore) : -1;
  const boardRanks = board.map(rankOf).sort((a, b) => b - a);
  const [h1, h2] = hero.map(rankOf).sort((a, b) => b - a);
  const top = boardRanks[0];

  if (board.length >= 5 && boardCat === cat && score === boardScore) {
    return { category: cat, label: `ボードの${CATEGORY_NAMES[cat]}（手札は使わない）`, strength: 0.15 };
  }

  if (cat === 1) {
    const pairRank = (score >> 16) & 15;
    const boardHasPair = boardRanks.filter((r) => r === pairRank).length >= 2;
    if (boardHasPair) {
      return { category: 1, label: `ボードのペア（${RANK_JA(Math.max(h1, h2))}ハイ）`, strength: 0.15 };
    }
    if (h1 === h2) {
      if (h1 > top) return { category: 1, label: `オーバーペア（${RANK_JA(h1)}${RANK_JA(h1)}）`, strength: 0.72 };
      const below = boardRanks.filter((r) => r > h1).length;
      return { category: 1, label: `ポケットペア（ボードの上に${below}枚）`, strength: below === 1 ? 0.45 : 0.3 };
    }
    const kicker = pairRank === h1 ? h2 : h1;
    if (pairRank === top) {
      const kickerGood = kicker >= 10; // Q以上
      return {
        category: 1,
        label: `トップペア（キッカー${RANK_JA(kicker)}）`,
        strength: kickerGood ? 0.62 : 0.52,
      };
    }
    if (pairRank === boardRanks[1]) return { category: 1, label: `セカンドペア（キッカー${RANK_JA(kicker)}）`, strength: 0.38 };
    return { category: 1, label: 'ボトムペア', strength: 0.28 };
  }
  if (cat === 2) {
    const usesBoth = boardRanks.includes(h1) && boardRanks.includes(h2) && h1 !== h2;
    const boardPaired = new Set(boardRanks).size < boardRanks.length;
    if (usesBoth) return { category: 2, label: 'ツーペア（両方の手札を使用）', strength: 0.78 };
    if (boardPaired) return { category: 2, label: 'ツーペア（ボードのペア＋自分のペア）', strength: 0.5 };
    return { category: 2, label: 'ツーペア', strength: 0.7 };
  }
  if (cat === 3) {
    if (h1 === h2) return { category: 3, label: `セット（${RANK_JA(h1)}）`, strength: 0.88 };
    const boardTrips = boardRanks.filter((r) => r === boardRanks.find((x) => boardRanks.filter((y) => y === x).length >= 3)).length >= 3;
    if (boardTrips) return { category: 3, label: 'ボードのスリーカード', strength: 0.3 };
    return { category: 3, label: 'トリップス', strength: 0.8 };
  }
  const base = [0.2, 0.5, 0.7, 0.8, 0.85, 0.9, 0.95, 0.99, 1][cat];
  return { category: cat, label: CATEGORY_NAMES[cat], strength: base };
}

export function analyzeDraws(hero: readonly [Card, Card], board: readonly Card[]): Draws {
  const res: Draws = { flushDraw: false, nutFlushDraw: false, oesd: false, gutshot: false, backdoorFlush: false, outs: 0, labels: [] };
  if (board.length < 3 || board.length >= 5) return res;
  const all = [...hero, ...board];
  const cat = categoryOf(evaluate(all));
  if (cat >= 4) return res; // 既にストレート以上

  // フラッシュドロー（自分のカードを1枚以上使う）
  const outsSet = new Set<number>();
  for (let s = 0; s < 4; s++) {
    const n = all.filter((c) => suitOf(c) === s).length;
    const heroUses = hero.some((c) => suitOf(c) === s);
    if (n === 4 && heroUses) {
      res.flushDraw = true;
      const heroHigh = Math.max(...hero.filter((c) => suitOf(c) === s).map(rankOf));
      const higherMissing = Array.from({ length: 13 }, (_, r) => r).filter(
        (r) => r > heroHigh && !all.some((c) => suitOf(c) === s && rankOf(c) === r),
      );
      res.nutFlushDraw = higherMissing.length === 0;
      for (let r = 0; r < 13; r++) {
        const card = (r << 2) | s;
        if (!all.includes(card)) outsSet.add(card);
      }
    } else if (n === 3 && heroUses && board.length === 3 && hero.every((c) => suitOf(c) === s)) {
      res.backdoorFlush = true;
    }
  }

  // ストレートドロー（自分のカードが必要なものだけ）
  const allMask = maskOf(all);
  const boardMask = maskOf(board);
  // ボードだけでストレートになるランクは除く（自分の手札が必要なドローのみ）
  const straightRanks = straightPossibleRanks(allMask).filter((r) => !hasStraight(boardMask | (1 << r)));
  if (straightRanks.length >= 2) res.oesd = true;
  else if (straightRanks.length === 1) res.gutshot = true;
  for (const r of straightRanks) for (let s = 0; s < 4; s++) {
    const card = (r << 2) | s;
    if (!all.includes(card)) outsSet.add(card);
  }

  res.outs = outsSet.size;
  if (res.flushDraw) res.labels.push(res.nutFlushDraw ? 'ナッツフラッシュドロー' : 'フラッシュドロー');
  if (res.oesd) res.labels.push('両面ストレートドロー');
  if (res.gutshot) res.labels.push('ガットショット');
  if (res.backdoorFlush) res.labels.push('バックドアフラッシュ');
  return res;
}

export function analyzeTexture(board: readonly Card[]): Texture {
  if (board.length === 0) return { paired: false, maxSuit: 0, wetness: 0, label: '' };
  const ranks = board.map(rankOf);
  const paired = new Set(ranks).size < ranks.length;
  const suitCount = [0, 0, 0, 0];
  for (const c of board) suitCount[suitOf(c)]++;
  const maxSuit = Math.max(...suitCount);
  // つながり：3枚以内の幅に入るランクの最大数
  const uniq = [...new Set(ranks)].sort((a, b) => a - b);
  let connected = 1;
  for (let i = 0; i < uniq.length; i++) {
    const n = uniq.filter((r) => r >= uniq[i] && r <= uniq[i] + 4).length;
    connected = Math.max(connected, n);
  }
  let wetness = 0;
  if (maxSuit >= 3) wetness += 0.5;
  else if (maxSuit === 2) wetness += 0.25;
  if (connected >= 3) wetness += 0.4;
  else if (connected === 2) wetness += 0.15;
  if (paired) wetness -= 0.15;
  if (uniq.filter((r) => r >= 8).length >= 2) wetness += 0.1; // ブロードウェイが多い
  wetness = Math.max(0, Math.min(1, wetness));
  const parts: string[] = [];
  parts.push(maxSuit >= 3 ? (maxSuit === board.length ? 'モノトーン' : '同スート3枚以上') : maxSuit === 2 ? 'ツートーン' : 'レインボー');
  if (paired) parts.push('ペアボード');
  if (connected >= 3) parts.push('コネクト');
  parts.push(wetness >= 0.55 ? 'ウェット' : wetness >= 0.3 ? 'ややウェット' : 'ドライ');
  return { paired, maxSuit, wetness, label: parts.join('・') };
}
