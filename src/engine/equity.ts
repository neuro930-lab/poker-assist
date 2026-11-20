import { FULL_DECK, type Card } from './cards';
import { evaluate } from './evaluator';

/** 重み付きの2枚の組み合わせ（相手のレンジ） */
export interface WeightedCombo {
  c1: Card;
  c2: Card;
  w: number;
}
export type Range = WeightedCombo[];

export interface EquityResult {
  /** 勝率（引き分けは山分けとして加算）0〜1 */
  equity: number;
  win: number;
  tie: number;
  samples: number;
  exact: boolean;
}

/** 再現性のある乱数（テストと表示のブレ防止） */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 使用済みカードと重なる組み合わせを除く */
export function filterRange(range: Range, dead: ReadonlySet<Card>): Range {
  return range.filter((x) => x.w > 0 && !dead.has(x.c1) && !dead.has(x.c2));
}

function sampler(range: Range, rand: () => number) {
  const cum = new Float64Array(range.length);
  let total = 0;
  for (let i = 0; i < range.length; i++) {
    total += range[i].w;
    cum[i] = total;
  }
  return () => {
    const x = rand() * total;
    let lo = 0;
    let hi = range.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return range[lo];
  };
}

/**
 * 自分の2枚・ボード・各相手のレンジから勝率を出す。
 * リバーで相手1人なら全組み合わせを数える（厳密）。それ以外はモンテカルロ。
 */
export function computeEquity(
  hero: readonly [Card, Card],
  board: readonly Card[],
  villains: Range[],
  opts: { iterations?: number; seed?: number } = {},
): EquityResult {
  const dead = new Set<Card>([...hero, ...board]);
  const ranges = villains.map((r) => {
    const f = filterRange(r, dead);
    return f.length > 0 ? f : anyTwoCards(dead);
  });

  if (board.length === 5 && ranges.length === 1) {
    const heroScore = evaluate([...hero, ...board]);
    let win = 0, tie = 0, total = 0;
    for (const v of ranges[0]) {
      const s = evaluate([v.c1, v.c2, ...board]);
      total += v.w;
      if (heroScore > s) win += v.w;
      else if (heroScore === s) tie += v.w;
    }
    return { equity: (win + tie / 2) / total, win: win / total, tie: tie / total, samples: ranges[0].length, exact: true };
  }

  const iterations = opts.iterations ?? 6000;
  const rand = mulberry32(opts.seed ?? 12345);
  const samplers = ranges.map((r) => sampler(r, rand));
  const need = 5 - board.length;
  const used = new Uint8Array(52);
  const heroCards: Card[] = [...hero, ...board];
  const vCards: Card[][] = ranges.map(() => [0, 0, ...board]);
  let share = 0, wins = 0, ties = 0, done = 0;

  for (let it = 0; it < iterations; it++) {
    used.fill(0);
    for (const c of dead) used[c] = 1;
    let ok = true;
    for (let v = 0; v < samplers.length; v++) {
      let tries = 0;
      let pick: WeightedCombo;
      do {
        pick = samplers[v]();
        tries++;
      } while ((used[pick.c1] || used[pick.c2]) && tries < 40);
      if (used[pick.c1] || used[pick.c2]) { ok = false; break; }
      used[pick.c1] = used[pick.c2] = 1;
      vCards[v][0] = pick.c1;
      vCards[v][1] = pick.c2;
    }
    if (!ok) continue;
    // 残りのボードを配る
    heroCards.length = 2 + board.length;
    for (const vc of vCards) vc.length = 2 + board.length;
    for (let k = 0; k < need; k++) {
      let c: Card;
      do c = Math.floor(rand() * 52); while (used[c]);
      used[c] = 1;
      heroCards.push(c);
      for (const vc of vCards) vc.push(c);
    }
    const hs = evaluate(heroCards);
    let best = true;
    let tiedWith = 0;
    for (const vc of vCards) {
      const s = evaluate(vc);
      if (s > hs) { best = false; break; }
      if (s === hs) tiedWith++;
    }
    done++;
    if (best) {
      if (tiedWith === 0) { wins++; share += 1; }
      else { ties++; share += 1 / (tiedWith + 1); }
    }
  }
  return { equity: done ? share / done : 0, win: done ? wins / done : 0, tie: done ? ties / done : 0, samples: done, exact: false };
}

export function anyTwoCards(dead: ReadonlySet<Card> = new Set()): Range {
  const out: Range = [];
  for (let i = 0; i < 52; i++) {
    if (dead.has(i)) continue;
    for (let j = i + 1; j < 52; j++) if (!dead.has(j)) out.push({ c1: FULL_DECK[i], c2: FULL_DECK[j], w: 1 });
  }
  return out;
}
