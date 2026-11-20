import { ACTION_LABELS, decide, type Decision, type Situation } from '../logic/decide';
import { displayName, postflopOrder, seatOfPosition, type Position } from '../logic/positions';
import { colorAt, handLevel, maxLevel, positionLevel, type Settings } from '../logic/settings';
import { tierMeanings, type Format } from '../logic/yokosawa';
import { analyzeDraws, analyzeMadeHand, analyzeTexture, type Draws, type MadeHand, type Texture } from './analysis';
import { handClass, parseCard, type Card } from './cards';
import { computeEquity, type EquityResult, type Range } from './equity';
import { estimatePreflopRange, narrowPostflop, rangePercent, toCombos, topOfRange, topPercentRange } from './ranges';
import type { GameState, Opponent } from './state';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export type AdviceAction = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allin';

export const ADVICE_LABELS: Record<AdviceAction, string> = {
  fold: 'フォールド',
  check: 'チェック',
  call: 'コール',
  bet: 'ベット',
  raise: 'レイズ',
  allin: 'オールイン',
};

export const STREET_LABELS: Record<Street, string> = {
  preflop: 'プリフロップ',
  flop: 'フロップ',
  turn: 'ターン',
  river: 'リバー',
};

export interface YokosawaInfo {
  hand: string;
  level: number;
  colorName: string;
  /** 表の凡例での意味（「EP（後ろに6〜7人）」など） */
  meaning: string;
  /** 自分のポジションの参加基準 */
  positionColor?: string;
  decision?: Decision;
}

export interface Advice {
  status: 'incomplete' | 'ok';
  /** 入力不足のときに何が足りないか */
  missing: string[];
  street: Street;
  action?: AdviceAction;
  /** 「2.5BB」「ポットの33%（約3.3）」など */
  sizing?: string;
  /** 一言で（「レイズ 2.5BB」） */
  headline: string;
  /** なぜそうなるか（上から重要な順） */
  reasons: string[];
  /** 他の選択肢・注意点 */
  notes: string[];
  numbers: { label: string; value: string }[];
  equity?: EquityResult;
  requiredEquity?: number;
  madeHand?: MadeHand;
  draws?: Draws;
  texture?: Texture;
  villainRanges: { position: Position; label: string; percent: number }[];
  /** 13×13表で強調する相手のレンジ（プリフロップの推定） */
  highlightHands: string[];
  yokosawa?: YokosawaInfo;
  heroHand?: string;
}

/** BBがポジションの悪さで実現できるエクイティの割合（概算） */
const BB_REALIZATION = 0.75;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ''));

function streetOf(board: readonly unknown[]): Street {
  return board.length >= 5 ? 'river' : board.length === 4 ? 'turn' : board.length >= 3 ? 'flop' : 'preflop';
}

function parseAll(texts: string[]): (Card | null)[] {
  return texts.map((t) => parseCard(t));
}

export function advise(state: GameState, settingsByFormat: Record<Format, Settings>): Advice {
  const s = settingsByFormat[state.format];
  const street = streetOf(state.board);
  const base: Advice = {
    status: 'incomplete', missing: [], street, headline: '', reasons: [], notes: [], numbers: [],
    villainRanges: [], highlightHands: [],
  };

  // ---- 入力チェック ----
  const heroParsed = parseAll(state.heroCards);
  const boardParsed = parseAll(state.board);
  if (heroParsed.length !== 2 || heroParsed.some((c) => c === null)) base.missing.push('自分の手札2枚');
  if (boardParsed.some((c) => c === null)) base.missing.push('ボードのカード（読めないものがあります）');
  if (![0, 3, 4, 5].includes(state.board.length)) base.missing.push('ボードは0・3・4・5枚');
  if (!state.heroPosition) base.missing.push('自分のポジション');
  const all = [...heroParsed, ...boardParsed].filter((c): c is Card => c !== null);
  if (new Set(all).size !== all.length) base.missing.push('同じカードが2回出ています');
  if (base.missing.length > 0) {
    base.headline = '入力待ち';
    return base;
  }
  const hero = heroParsed as [Card, Card];
  const board = boardParsed as Card[];
  const heroPos = state.heroPosition!;
  const hand = handClass(hero[0], hero[1]);
  base.heroHand = hand;

  // ---- ヨコサワ表での位置 ----
  const level = handLevel(s, hand);
  const meanings = tierMeanings(state.format);
  const color = colorAt(s, level);
  const P = positionLevel(s, heroPos);
  base.yokosawa = {
    hand,
    level,
    colorName: color.name,
    meaning: meanings.find((m) => m.name === color.name)?.meaning ?? '',
    positionColor: P !== undefined ? colorAt(s, P).name : undefined,
  };

  // ---- 相手のレンジ ----
  const dead = new Set<Card>([...hero, ...board]);
  const opponents = state.opponents.length > 0 ? state.opponents : defaultOpponents(state);
  const pre = opponents.map((o) => ({ o, est: estimatePreflopRange(o, state, s) }));
  const highlight = new Set<string>();
  for (const { est } of pre) for (const h of Object.keys(est.weights)) if (est.weights[h] >= 0.5) highlight.add(h);
  // 誰も参加していないプリフロップは「相手のレンジ」がほぼ全ハンドなので強調しない
  const unopened = street === 'preflop' && (state.preflop === 'unopened' || state.preflop === 'limped') && state.opponents.length === 0;
  base.highlightHands = unopened ? [] : [...highlight];

  let villainRanges: Range[] = pre.map(({ est }) => toCombos(est.weights, dead));
  if (street !== 'preflop') {
    villainRanges = villainRanges.map((r, i) => {
      // 自分の前で行動した相手にだけ今のストリートのアクションを当てはめる（全員同じ扱いの概算）
      // コール額があるのに「ベットなし」になっていたらベットされたとみなす
      const act = state.toCall > 0 && (state.villainAction === 'none' || state.villainAction === 'check') ? 'bet' : state.villainAction;
      return narrowPostflop(r, board, i === 0 || act !== 'raise' ? act : 'bet', state.villainBetsEarlier);
    });
  }
  base.villainRanges = pre.map(({ o, est }) => ({ position: o.position, label: est.label, percent: rangePercent(est.weights) }));

  const bb = state.bigBlind > 0 ? state.bigBlind : 1;
  const effStack = Math.min(
    state.heroStack,
    ...opponents.map((o) => (o.stack !== null && o.stack > 0 ? o.stack : Infinity)),
  );
  const effBB = effStack / bb;
  const potBB = state.pot / bb;
  const callBB = state.toCall / bb;

  const equity = computeEquity(hero, board, villainRanges, {
    iterations: street === 'preflop' ? 3000 : opponents.length > 1 ? 5000 : 6000,
    seed: 20261120,
  });
  base.equity = equity;
  const req = state.toCall > 0 ? state.toCall / (state.pot + state.toCall) : 0;
  base.requiredEquity = req;

  base.numbers.push({ label: 'ポット', value: `${fmt(potBB)}BB` });
  const showCall = state.toCall > 0 && !unopened;
  if (showCall) base.numbers.push({ label: 'コール額', value: `${fmt(callBB)}BB` });
  base.numbers.push({ label: '有効スタック', value: `${fmt(effBB)}BB` });
  if (street !== 'preflop' && state.pot > 0) base.numbers.push({ label: 'SPR', value: fmt(effStack / state.pot) });
  base.numbers.push({ label: '勝率（推定レンジ相手）', value: pct(equity.equity) });
  if (showCall) base.numbers.push({ label: 'コールに必要な勝率', value: pct(req) });

  const ctx: Ctx = { state, s, hero, board, heroPos, hand, equity, req, effStack, effBB, potBB, callBB, opponents, pre, bb };
  const result = street === 'preflop' ? preflopAdvice(base, ctx) : postflopAdvice(base, ctx);
  result.status = 'ok';
  return result;
}

interface Ctx {
  state: GameState;
  s: Settings;
  hero: [Card, Card];
  board: Card[];
  heroPos: Position;
  hand: string;
  equity: EquityResult;
  req: number;
  effStack: number;
  effBB: number;
  potBB: number;
  callBB: number;
  opponents: Opponent[];
  pre: { o: Opponent; est: ReturnType<typeof estimatePreflopRange> }[];
  bb: number;
}

/** 相手の情報がないときの仮の相手（プリフロップのシナリオから） */
function defaultOpponents(state: GameState): Opponent[] {
  const pos: Position = state.heroPosition === 'BB' ? 'BTN' : 'BB';
  const role = state.preflop === 'raised' ? 'opener' : state.preflop === 'unopened' ? 'blind' : 'unknown';
  return [{ position: pos, stack: null, role }];
}

// ======================= プリフロップ =======================

function preflopAdvice(a: Advice, c: Ctx): Advice {
  const { state, s, hand, heroPos } = c;
  const label = (p: Position) => displayName(p, state.players, s.labelFirstSeatAsUtg);
  const H = handLevel(s, hand);
  const top = maxLevel(s);
  const name = (lv: number) => colorAt(s, Math.max(0, Math.min(lv, top))).name;
  const P = positionLevel(s, heroPos);
  const openSize = state.format === 'tournament' ? 2.2 : 2.5;
  const limpers = state.opponents.filter((o) => o.role === 'limper').length;
  const yk = a.yokosawa!;
  const handText = `${hand}はヨコサワ表で「${yk.colorName}」${yk.meaning ? `（${yk.meaning}）` : ''}`;

  // ---- ショートスタック：プッシュ／フォールド ----
  const canJamSpot = state.preflop === 'unopened' || state.preflop === 'limped' || state.preflop === 'raised';
  if (canJamSpot && c.effBB <= 12 && !(heroPos === 'BB' && state.preflop !== 'raised' && state.toCall === 0)) {
    return pushFold(a, c, handText);
  }

  // ---- ヨコサワ判定（decide.ts を流用） ----
  const players = state.players;
  const mySeat = seatOfPosition(heroPos, players);
  let situation: Situation = 'normal';
  let oppPos: Position | null = null;
  const opener = state.opponents.find((o) => o.role === 'opener');
  const threeBettor = state.opponents.find((o) => o.role === '3bettor');
  if (state.preflop === 'raised') oppPos = opener?.position ?? c.opponents[0]?.position ?? null;
  if (state.preflop === '3bet' && !opener) {
    situation = 'vs3bet';
    oppPos = threeBettor?.position ?? null;
  }
  const decision =
    mySeat !== null
      ? decide({
          players, btnSeat: 0, mySeat, hand,
          opponentSeat: oppPos ? seatOfPosition(oppPos, players) : null,
          situation, settings: s,
        })
      : undefined;
  yk.decision = decision;

  const eqLine = `推定レンジ相手の勝率 ${pct(c.equity.equity)}`;
  const set = (action: AdviceAction, headline: string, sizing?: string) => {
    a.action = action;
    a.headline = headline;
    a.sizing = sizing;
  };

  if (state.preflop === 'unopened' || state.preflop === 'limped') {
    if (heroPos === 'BB' && state.toCall === 0) {
      // リンプされたBB：強いハンドだけアイソレート
      const threshold = positionLevel(s, 'CO') ?? 3;
      if (H >= threshold + 1) {
        const size = 3 + limpers;
        set('raise', `レイズ ${size}BB`, `${size}BB`);
        a.reasons.push(`${handText}。リンプに対してBBから主導権を取りに行けるハンド`);
      } else {
        set('check', 'チェック');
        a.reasons.push(`${handText}。BBは無料でフロップを見られるのでチェック`);
      }
      a.reasons.push(eqLine);
      return a;
    }
    if (P === undefined) {
      set('fold', 'フォールド');
      a.reasons.push(`${label(heroPos)}の参加基準が未設定です`);
      return a;
    }
    if (H >= P) {
      const size = openSize + limpers;
      set('raise', `${limpers ? 'アイソレートレイズ' : 'オープンレイズ'} ${fmt(size)}BB`, `${fmt(size)}BB`);
      a.reasons.push(`${handText}。${label(heroPos)}の参加基準「${name(P)}」以上なのでレイズ`);
      if (limpers) a.reasons.push(`リンパー${limpers}人につき1BB足して大きめに（主導権とポットの単独化）`);
      a.reasons.push('ポーカーは先にレイズする側が有利：相手を降ろせる＋強いハンドで大きなポットを作れる');
    } else {
      set('fold', 'フォールド');
      a.reasons.push(`${handText}。${label(heroPos)}の基準「${name(P)}」に届かない`);
      a.reasons.push(
        `後ろに残っている人が多いほど強いハンドを持っている確率が上がるため、${label(heroPos)}からは参加できない`,
      );
      if (limpers === 0 && (heroPos === 'BTN' || heroPos === 'SB') && H >= P - 1 && H > 0)
        a.notes.push('基準の1段下：ブラインドが極端にタイトならスチールも可');
    }
    a.reasons.push(eqLine);
    return a;
  }

  if (state.preflop === 'raised' && decision?.status === 'action' && decision.action) {
    const act = decision.action;
    const ip = oppPos ? postflopOrder(heroPos, players) > postflopOrder(oppPos, players) : false;
    if (act === '3bet') {
      const mult = ip ? 3 : 4;
      const big = c.effBB <= 30;
      set(big ? 'allin' : 'raise', big ? 'オールイン（3ベット）' : `3ベット（相手のレイズ額の${mult}倍）`, big ? `${fmt(c.effBB)}BB` : `${mult}倍`);
      a.reasons.push(decision.reason);
      a.reasons.push(`相手のオープンレンジに対して優位（${eqLine}）。コールより大きなポットを有利な状態で作れる`);
      if (big) a.reasons.push('有効スタックが30BB以下なので、3ベットするならオールインで相手のプレーの余地をなくす');
      a.notes.push(ip ? 'ポジションがあるので3倍で十分' : 'ポジションが悪い（OOP）ので4倍程度に大きく');
    } else if (act === 'call') {
      set('call', 'コール');
      a.reasons.push(decision.reason);
      a.reasons.push(`${eqLine}、必要勝率 ${pct(c.req)}`);
      if (heroPos === 'BB') a.reasons.push('BBは既に1BB払っていて、ポットオッズが良い');
      else if (!ip) a.notes.push('ポジションが悪いコールはエクイティを実現しにくいので、迷うならフォールド寄りで');
    } else if (heroPos === 'BB' && c.equity.equity * BB_REALIZATION >= c.req + 0.01 && c.callBB <= c.effBB * 0.35) {
      // エンジン補正：ヨコサワ表ではフォールドでも、BBはオッズが良いのでソルバーは広く守る
      set('call', 'コール（エンジン補正）');
      a.reasons.push(`ヨコサワ表ではフォールド（${decision.reason}）`);
      a.reasons.push(
        `ただしBBはオッズが非常に良い：${eqLine}、ポジションが悪い分を割り引いても（×${BB_REALIZATION}）必要勝率 ${pct(c.req)} を上回る → コールで守るほうが得`,
      );
      a.notes.push('フロップで当たらなければ素直に降りる前提のコール。トーナメントの入賞直前（ICM）ではフォールド寄りに');
    } else {
      set('fold', 'フォールド');
      a.reasons.push(decision.reason);
      a.reasons.push(`相手のレンジに対して不利（${eqLine}、必要勝率 ${pct(c.req)}）`);
    }
    for (const n of decision.notes) a.notes.push(n);
    return a;
  }

  if (state.preflop === '3bet' && !opener) {
    // 自分のオープンが3ベットされた
    if (P === undefined) {
      set('fold', 'フォールド');
      return a;
    }
    const callMin = Math.min(P + s.reraiseStep, top);
    const fourMin = Math.min(P + s.reraiseStep + s.fourBetStep, top);
    const range = decision?.opponentRange;
    if (H >= fourMin) {
      const jam = c.effBB <= 45;
      set(jam ? 'allin' : 'raise', jam ? 'オールイン（4ベット）' : '4ベット（3ベット額の約2.3倍）', jam ? `${fmt(c.effBB)}BB` : '約2.3倍');
      a.reasons.push(`${handText}。相手の3ベットレンジ（${range?.text ?? ''}）の中でも上位なので4ベット`);
    } else if (H >= callMin) {
      set('call', 'コール');
      a.reasons.push(`${handText}。相手の3ベットレンジ（${range?.text ?? ''}）と同等以上なのでコール`);
    } else {
      set('fold', 'フォールド');
      a.reasons.push(`${handText}。相手の3ベットレンジ（${range?.text ?? ''}）より弱いのでフォールド`);
      if (c.equity.equity > c.req) a.notes.push('ポットオッズ上はコールも検討可（相手が3ベットを多用するなら）');
    }
    a.reasons.push(`${eqLine}、必要勝率 ${pct(c.req)}`);
    if (decision?.reason) a.notes.push(decision.reason);
    return a;
  }

  if (state.preflop === '3bet') {
    // 他人のオープン→3ベットに直面（コールドで）
    if (H >= top) {
      set('raise', '4ベット（3ベット額の約2.3倍）', '約2.3倍');
      a.reasons.push(`${handText}。オープンと3ベットの両方に勝っている最上位ハンド`);
    } else if (H >= top - 1 && c.equity.equity >= c.req + 0.05) {
      set('call', 'コール');
      a.reasons.push(`${handText}。3ベットレンジに対しても戦えるのでコール`);
    } else {
      set('fold', 'フォールド');
      a.reasons.push(`${handText}。オープン＋3ベットの2人を相手にするには弱い`);
    }
    a.reasons.push(`${eqLine}、必要勝率 ${pct(c.req)}`);
    return a;
  }

  if (state.preflop === '4bet') {
    if (H >= top || c.equity.equity >= 0.5) {
      set('allin', 'オールイン', `${fmt(c.effBB)}BB`);
      a.reasons.push(`${handText}。4ベットレンジ（ほぼ最上位のみ）に対しても戦える`);
    } else if (c.equity.equity >= c.req) {
      set('call', 'コール');
      a.reasons.push('ポットオッズ上はコールが上回る');
    } else {
      set('fold', 'フォールド');
      a.reasons.push(`${handText}。4ベットレンジは非常に強く、勝てる見込みが低い`);
    }
    a.reasons.push(`${eqLine}、必要勝率 ${pct(c.req)}`);
    return a;
  }

  set('fold', '判定できません');
  a.reasons.push('プリフロップの状況（誰がレイズしたか）を確認してください');
  return a;
}

/** 有効スタック12BB以下：オールインかフォールドかをチップEVで比べる */
function pushFold(a: Advice, c: Ctx, handText: string): Advice {
  const { state, hero, heroPos } = c;
  const E = c.effStack / c.bb; // BB単位
  const pot = c.potBB;
  // 相手のコール率：スタックが浅いほど広くコールする（ナッシュ均衡の傾向を近似）
  const callPctFor = (o: Opponent) => {
    const basePct = Math.min(45, Math.max(8, 120 / Math.max(E, 1) + 4));
    return o.position === 'BB' ? Math.min(55, basePct * 1.5) : o.role === 'opener' ? Math.min(60, basePct * 2.2) : basePct;
  };
  let behind: Opponent[];
  if (state.preflop === 'raised') {
    behind = state.opponents.length ? state.opponents : [{ position: 'BTN', stack: null, role: 'opener' }];
  } else {
    // 自分より後ろでまだ行動していない人（オープンなら全員）
    const order = ['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as Position[];
    const idx = order.indexOf(heroPos);
    behind = state.opponents.length
      ? state.opponents
      : order.slice(idx + 1).slice(-Math.max(0, state.players - 1)).map((p) => ({ position: p, stack: null, role: 'unknown' as const }));
    if (behind.length === 0) behind = [{ position: 'BB', stack: null, role: 'blind' }];
  }
  const probs = behind.map((o) => callPctFor(o) / 100);
  const pAllFold = probs.reduce((acc, p) => acc * (1 - p), 1);
  // コールしてくる相手は一番広い人のレンジで代表させる
  const widest = Math.max(...behind.map(callPctFor));
  const callRange = state.preflop === 'raised'
    ? topOfRange(c.pre[0]?.est.weights ?? topPercentRange(30), 0.5)
    : topPercentRange(widest);
  const eqVsCall = computeEquity(hero, [], [toCombos(callRange, new Set(hero))], { iterations: 4000, seed: 99 }).equity;
  const evJam = pAllFold * pot + (1 - pAllFold) * (eqVsCall * (pot + 2 * E) - E);
  a.numbers.push({ label: 'オールインのEV（チップ・概算）', value: `${evJam >= 0 ? '+' : ''}${fmt(evJam)}BB` });
  a.numbers.push({ label: '全員フォールドする確率', value: pct(pAllFold) });
  a.numbers.push({ label: 'コールされたときの勝率', value: pct(eqVsCall) });
  const jam = evJam > 0.1;
  a.action = jam ? 'allin' : 'fold';
  a.headline = jam ? 'オールイン' : 'フォールド';
  a.sizing = jam ? `${fmt(E)}BB` : undefined;
  a.reasons.push(`有効スタック${fmt(E)}BB：12BB以下は小さくレイズするより「オールインかフォールド」が最も損が少ない`);
  a.reasons.push(
    jam
      ? `オールインの期待値 +${fmt(evJam)}BB（全員が降りる${pct(pAllFold)}でポット${fmt(pot)}BBを獲得、コールされても勝率${pct(eqVsCall)}）`
      : `オールインの期待値 ${fmt(evJam)}BB（コールされたときの勝率${pct(eqVsCall)}が足りない）`,
  );
  a.reasons.push(handText);
  if (state.format === 'tournament') a.notes.push('バブル・入賞直前はICM（賞金の重み）でフォールド寄りに。上の数字はチップEVです');
  return a;
}

// ======================= フロップ以降 =======================

function postflopAdvice(a: Advice, c: Ctx): Advice {
  const { state, hero, board, heroPos, equity } = c;
  const made = analyzeMadeHand(hero, board);
  const draws = analyzeDraws(hero, board);
  const texture = analyzeTexture(board);
  a.madeHand = made;
  a.draws = draws;
  a.texture = texture;
  const n = c.opponents.length;
  const eq = equity.equity;
  const fair = 1 / (n + 1);
  const valueTh = fair + 0.3 * (1 - fair);
  const raiseTh = fair + 0.45 * (1 - fair);
  const street = a.street;
  const ip = c.opponents.every((o) => postflopOrder(heroPos, state.players) > postflopOrder(o.position, state.players));
  const spr = state.pot > 0 ? c.effStack / state.pot : 99;
  const handLine = `${made.label}${draws.labels.length ? `＋${draws.labels.join('・')}（アウツ${draws.outs}枚）` : ''}`;
  a.numbers.push({ label: 'ボード', value: texture.label });
  if (draws.outs > 0 && street !== 'river') {
    const cardsLeft = street === 'flop' ? 2 : 1;
    // 4-2ルール（アウツが8枚を超えるとき、フロップでは「4×アウツ −（アウツ−8）」に補正）
    const raw = draws.outs * (cardsLeft === 2 ? 4 : 2);
    const approx = Math.min(100, cardsLeft === 2 && draws.outs > 8 ? raw - (draws.outs - 8) : raw);
    a.numbers.push({ label: '完成する確率（4-2ルール）', value: `約${approx}%（アウツ${draws.outs}）` });
  }

  const potAmt = state.pot;
  const sizeText = (frac: number) => `ポットの${Math.round(frac * 100)}%（約${fmt((potAmt * frac) / c.bb)}BB）`;

  if (state.toCall > 0) {
    // ---- ベットに直面 ----
    const allInCall = state.toCall >= state.heroStack;
    const realization = ip ? 1 : 0.9;
    const implied = street !== 'river' && (draws.flushDraw || draws.oesd) && spr > 2 ? 0.05 : 0;
    const effEq = eq * realization + implied;
    a.reasons.push(`手役：${handLine}`);
    if (!allInCall && eq >= raiseTh) {
      const shove = spr <= 2.5;
      a.action = shove ? 'allin' : 'raise';
      a.headline = shove ? 'オールイン（レイズ）' : 'レイズ（相手のベットの約3倍）';
      a.sizing = shove ? `${fmt(c.effBB)}BB` : '約3倍';
      a.reasons.push(`相手のベットレンジに対して勝率${pct(eq)}と大きく有利 → バリューのためにレイズ`);
      if (shove) a.reasons.push(`SPRが${fmt(spr)}と小さいので、そのままオールインで最大化`);
      else if (texture.wetness < 0.3 && made.strength < 0.85 && street !== 'river')
        a.notes.push('ドライボードでは、コールして相手のブラフを残す（次のストリートで打たせる）のも有力');
    } else if (!allInCall && street === 'flop' && n === 1 && draws.outs >= 12 && eq >= 0.4) {
      a.action = 'raise';
      a.headline = 'レイズ（セミブラフ）';
      a.sizing = '約3倍';
      a.reasons.push(`アウツ${draws.outs}枚の強いドロー：相手を降ろせる＋外れても勝率${pct(eq)}ある → セミブラフレイズ`);
      a.notes.push('コールでも可。相手が降りないタイプならコールで');
    } else if (effEq >= c.req) {
      a.action = allInCall ? 'allin' : 'call';
      a.headline = allInCall ? 'コール（オールイン）' : 'コール';
      a.reasons.push(
        `勝率${pct(eq)}${ip ? '' : '（ポジションが悪いので×0.9で評価）'}${implied ? '＋インプライドオッズ' : ''} ≧ 必要勝率${pct(c.req)} → コールが得`,
      );
      if (eq < valueTh && street !== 'river') a.notes.push('次のストリートで大きく打たれたら再評価');
    } else {
      a.action = 'fold';
      a.headline = 'フォールド';
      a.reasons.push(`勝率${pct(eq)} < 必要勝率${pct(c.req)}：ポットオッズが足りない`);
      if (draws.outs > 0 && street !== 'river') a.notes.push(`ドロー（アウツ${draws.outs}）はあるが、ベット額に対して見合わない`);
    }
    a.reasons.push(`相手は${state.villainAction === 'raise' ? 'レイズ' : 'ベット'}してきたので、強いハンド寄りにレンジを絞って勝率を計算`);
    return a;
  }

  // ---- チェックで回ってきた／最初に行動 ----
  a.reasons.push(`手役：${handLine}`);
  const sizeFrac =
    spr <= 1.2 ? 1 : texture.wetness >= 0.55 ? 0.75 : texture.wetness >= 0.3 ? 0.5 : 0.33;
  const strongDraw = draws.outs >= 8 && street !== 'river';
  const villainChecked = state.villainAction === 'check';
  if (eq >= valueTh) {
    const river = street === 'river';
    const frac = river && eq >= 0.8 ? 0.75 : sizeFrac;
    const shove = spr <= 1.2;
    a.action = shove ? 'allin' : 'bet';
    a.headline = shove ? 'オールイン' : `ベット ${Math.round(frac * 100)}%`;
    a.sizing = shove ? `${fmt(c.effBB)}BB` : sizeText(frac);
    a.reasons.push(`推定レンジに対して勝率${pct(eq)}：弱いハンドからコールをもらえる → バリューベット`);
    a.reasons.push(
      frac >= 0.75
        ? `${texture.label}ボードなので大きめ（相手のドローに正しいオッズを与えない）`
        : frac <= 0.33
          ? `${texture.label}ボードなので小さめで広くコールさせる`
          : '中くらいのサイズでバリューと保護を両立',
    );
    if (made.strength >= 0.85 && texture.wetness < 0.3 && !ip && street === 'flop')
      a.notes.push('ドライボードの非常に強い手：チェックレイズを狙うのも有力');
  } else if (strongDraw && (ip || villainChecked || state.heroIsAggressor) && n <= 2) {
    a.action = 'bet';
    a.headline = `ベット ${Math.round(Math.max(sizeFrac, 0.5) * 100)}%（セミブラフ）`;
    a.sizing = sizeText(Math.max(sizeFrac, 0.5));
    a.reasons.push(`アウツ${draws.outs}枚のドロー：相手を降ろす勝ち方と、完成して勝つ勝ち方の2通りがある → セミブラフ`);
  } else if (state.heroIsAggressor && street === 'flop' && n === 1 && texture.wetness < 0.3 && eq >= 0.3) {
    a.action = 'bet';
    a.headline = 'ベット 33%（Cベット）';
    a.sizing = sizeText(0.33);
    a.reasons.push('プリフロップのレイザーはドライボードでレンジ有利 → 小さいCベットを高頻度で');
    a.reasons.push(`勝率${pct(eq)}：現状負けていても、相手の多くのハンドを降ろせる`);
  } else if (state.heroIsAggressor && street !== 'river' && n === 1 && villainChecked && eq >= 0.25 && texture.wetness < 0.45) {
    a.action = 'bet';
    a.headline = `ベット ${Math.round(sizeFrac * 100)}%`;
    a.sizing = sizeText(sizeFrac);
    a.reasons.push('相手がチェックして弱さを見せた＋自分がアグレッサー → ベットで降ろしにいく');
  } else {
    a.action = 'check';
    a.headline = 'チェック';
    a.reasons.push(
      eq >= fair
        ? `勝率${pct(eq)}：ショーダウンバリューはあるが、ベットして強いハンドにだけコールされる形を避ける`
        : `勝率${pct(eq)}：ベットしても弱いハンドは降り、強いハンドにだけコールされる`,
    );
    if (street === 'river' && eq < 0.15 && state.heroIsAggressor && n === 1)
      a.notes.push('ほぼ勝てない手：相手のレンジが弱い（キャップされている）ならブラフも選択肢');
    if (!ip && eq >= 0.45) a.notes.push('相手がベットしてきたら、必要勝率と比べてコールを検討');
  }
  if (n > 1) a.notes.push(`${n}人が相手（マルチウェイ）：ブラフは控えめ、バリューは強めのハンドで`);
  return a;
}

export { ACTION_LABELS };
