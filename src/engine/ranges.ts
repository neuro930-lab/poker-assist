import { ALL_HANDS, combosOf } from '../logic/hands';
import type { Position } from '../logic/positions';
import { colorAt, handLevel, maxLevel, positionLevel, type Settings } from '../logic/settings';
import { combosOfClass, type Card } from './cards';
import { analyzeDraws } from './analysis';
import { evaluate } from './evaluator';
import type { Range } from './equity';
import { PREFLOP_EQUITY_VS_RANDOM } from './preflopEquity';
import type { GameState, Opponent } from './state';

export interface RangeEstimate {
  /** 「HJのオープン（緑以上）」など */
  label: string;
  /** ハンド名 → 重み（0〜1） */
  weights: Record<string, number>;
}

const lvl = (s: Settings, rawMin: number) => Math.max(1, Math.min(rawMin, maxLevel(s)));

function levelRange(s: Settings, min: number, opts: { trapAbove?: number; trapWeight?: number } = {}) {
  const w: Record<string, number> = {};
  const m = lvl(s, min);
  for (const h of ALL_HANDS) {
    const L = handLevel(s, h);
    if (L < m) continue;
    w[h] = opts.trapAbove !== undefined && L >= opts.trapAbove ? (opts.trapWeight ?? 0.3) : 1;
  }
  return { weights: w, min: m };
}

const colorText = (s: Settings, lv: number) =>
  lv >= maxLevel(s) ? `${colorAt(s, lv).name}のみ` : `${colorAt(s, lv).name}以上`;

/** BBがコールしてくる最低レベル（decide.ts の BB 判定と同じ式） */
export function bbDefendMin(s: Settings, raiserPos: Position, raiserBase: number): number {
  const late = raiserPos === 'BTN' || raiserPos === 'SB';
  return Math.max(late ? 1 : 2, raiserBase - s.bbDefendSteps);
}

/** 自分以外でプリフロップのオープンをした人（自分がオープンなら自分）のポジション */
function openerPosition(state: GameState): Position | null {
  const op = state.opponents.find((o) => o.role === 'opener');
  if (op) return op.position;
  // 相手にオープンした人がいない＝自分がオープンした（そのままか、3ベットされてコール／4ベット）
  if (state.preflop === 'raised' || state.preflop === '3bet' || state.preflop === '4bet') return state.heroPosition;
  return null;
}

/** 相手1人のプリフロップレンジ（ヨコサワ表の段階から推定） */
export function estimatePreflopRange(opp: Opponent, state: GameState, s: Settings): RangeEstimate {
  const name = opp.position;
  const step = s.reraiseStep;
  const base = (p: Position | null) => (p ? positionLevel(s, p) : undefined);
  const openerPos = openerPosition(state);
  const O = base(openerPos) ?? 2;

  switch (opp.role) {
    case 'opener': {
      const R = base(opp.position) ?? 2;
      const r = levelRange(s, R);
      return { label: `${name}のオープン（${colorText(s, r.min)}）`, weights: r.weights };
    }
    case '3bettor': {
      const r = levelRange(s, O + step);
      return { label: `${name}の3ベット（${colorText(s, r.min)}）`, weights: r.weights };
    }
    case '4bettor': {
      const r = levelRange(s, O + step + s.fourBetStep);
      return { label: `${name}の4ベット（${colorText(s, r.min)}）`, weights: r.weights };
    }
    case 'caller': {
      if (state.preflop === '3bet' || state.preflop === '4bet') {
        const r = levelRange(s, O + step, { trapAbove: lvl(s, O + step + s.fourBetStep), trapWeight: 0.4 });
        return { label: `${name}の3ベットへのコール（${colorText(s, r.min)}）`, weights: r.weights };
      }
      if (opp.position === 'BB' && openerPos) {
        const min = bbDefendMin(s, openerPos, O);
        const r = levelRange(s, min, { trapAbove: lvl(s, O + step) });
        return { label: `BBのディフェンス（${colorText(s, r.min)}）`, weights: r.weights };
      }
      const r = levelRange(s, O + 1, { trapAbove: lvl(s, O + step) });
      return { label: `${name}のコール（${colorText(s, r.min)}）`, weights: r.weights };
    }
    case 'limper': {
      const w: Record<string, number> = {};
      const top = maxLevel(s);
      for (const h of ALL_HANDS) {
        const L = handLevel(s, h);
        w[h] = L === 0 ? 0.15 : L >= top - 1 ? 0.25 : 1;
      }
      return { label: `${name}のリンプ（広め・強いハンドは少なめ）`, weights: w };
    }
    case 'blind': {
      const w: Record<string, number> = {};
      for (const h of ALL_HANDS) w[h] = handLevel(s, h) >= maxLevel(s) - 1 ? 0.3 : 1;
      return { label: `${name}（ブラインドでチェック・ほぼ全ハンド）`, weights: w };
    }
    default: {
      if (state.preflop === 'unopened' || state.preflop === 'limped') {
        const w: Record<string, number> = {};
        for (const h of ALL_HANDS) w[h] = handLevel(s, h) === 0 ? 0.4 : 1;
        return { label: `${name}（情報なし・広め）`, weights: w };
      }
      const r = levelRange(s, 1);
      return { label: `${name}（情報なし・参加ハンド全体）`, weights: r.weights };
    }
  }
}

/** 重み付きハンド名 → 具体的な組み合わせ（使用済みカードは除く） */
export function toCombos(weights: Record<string, number>, dead: ReadonlySet<Card>): Range {
  const out: Range = [];
  for (const [h, w] of Object.entries(weights)) {
    if (w <= 0) continue;
    for (const [c1, c2] of combosOfClass(h)) if (!dead.has(c1) && !dead.has(c2)) out.push({ c1, c2, w });
  }
  return out;
}

/** レンジが全体の何%か（重み込み） */
export function rangePercent(weights: Record<string, number>): number {
  let sum = 0;
  for (const [h, w] of Object.entries(weights)) sum += w * combosOf(h);
  return (sum / 1326) * 100;
}

/** 上位 pct% のハンド（ランダム相手への勝率順）。プッシュ／フォールドのコールレンジ用 */
export function topPercentRange(pct: number): Record<string, number> {
  const sorted = [...ALL_HANDS].sort((a, b) => PREFLOP_EQUITY_VS_RANDOM[b] - PREFLOP_EQUITY_VS_RANDOM[a]);
  const w: Record<string, number> = {};
  let acc = 0;
  for (const h of sorted) {
    if ((acc / 1326) * 100 >= pct) break;
    w[h] = 1;
    acc += combosOf(h);
  }
  return w;
}

/** 渡したレンジの中で強い方から frac の割合だけを残す（プリフロップの強さ順） */
export function topOfRange(weights: Record<string, number>, frac: number): Record<string, number> {
  const hands = Object.keys(weights).sort((a, b) => PREFLOP_EQUITY_VS_RANDOM[b] - PREFLOP_EQUITY_VS_RANDOM[a]);
  const total = hands.reduce((s, h) => s + weights[h] * combosOf(h), 0);
  const out: Record<string, number> = {};
  let acc = 0;
  for (const h of hands) {
    if (acc >= total * frac) break;
    out[h] = weights[h];
    acc += weights[h] * combosOf(h);
  }
  return out;
}

/**
 * フロップ以降の相手のアクションでレンジを絞る。
 * ボード上での強さ（役＋ドロー）の順位を出し、ベット・レイズなら強い側を残し、チェックなら強い側を減らす。
 */
export function narrowPostflop(
  range: Range,
  board: readonly Card[],
  action: 'none' | 'check' | 'bet' | 'raise',
  earlierBets: number,
): Range {
  if (board.length < 3 || range.length === 0) return range;
  const scored = range.map((x) => {
    let v = evaluate([x.c1, x.c2, ...board]);
    if (board.length < 5) {
      const d = analyzeDraws([x.c1, x.c2], board);
      // 強いドローはミドルペア程度の強さとして扱う
      if (d.outs >= 8) v = Math.max(v, (1 << 20) + (8 << 16));
    }
    return { x, v };
  });
  scored.sort((a, b) => a.v - b.v);
  const n = scored.length;
  return scored.map(({ x }, i) => {
    const pct = n > 1 ? i / (n - 1) : 1; // 1 が最強
    let w = x.w;
    for (let k = 0; k < earlierBets; k++) w *= pct >= 0.35 ? 1 : 0.3;
    if (action === 'bet') w *= pct >= 0.45 ? 1 : 0.25;
    else if (action === 'raise') w *= pct >= 0.75 ? 1 : 0.1;
    else if (action === 'check') w *= pct >= 0.85 ? 0.4 : 1;
    return { c1: x.c1, c2: x.c2, w };
  });
}
