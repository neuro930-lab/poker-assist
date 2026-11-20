import { z } from 'zod';
import { positionOfSeat, positionsFor } from '../logic/positions';
import type { Format } from '../logic/yokosawa';
import { cardToString, parseCard } from '../engine/cards';
import type { GameState, Opponent, OpponentRole, PreflopScenario, StreetAction } from '../engine/state';

/**
 * AIには「見えたものをそのまま」書き出させ、ポジション・ポット・コール額・誰がレイズしたかは
 * このファイルで計算する（AIに数え方を任せると間違えることがあるため）。
 */
const ACTION = z.enum(['none', 'check', 'call', 'bet', 'raise', 'allin', 'fold']);

export const ScreenSchema = z.object({
  is_poker_table: z.boolean().describe('ポーカーのテーブル画面か'),
  hand_in_progress: z.boolean().describe('自分の手札2枚が表向きで見えているか'),
  is_hero_turn: z.boolean().describe('自分のアクション番か（コール／レイズ等の操作ボタンが出ている。「予約」ボタンだけなら false）'),
  notes: z.string().describe('自信がない点だけを20文字以内で。なければ空'),
  format: z.enum(['ring', 'tournament', 'unknown']).describe('順位やLv表示があれば tournament'),
  hero_cards: z.array(z.string()).describe('自分の手札（"6h" "Tc" の形式）'),
  board: z.array(z.string()).describe('テーブル中央の表向きのカード（同じ形式）。なければ空'),
  center_pot: z.number().nullable().describe('中央の POT の数字'),
  big_blind: z.number().nullable().describe('BB額が画面に書いてあれば。なければ null'),
  seats: z
    .array(
      z.object({
        stack: z.number().nullable().describe('名前の下の数字（残りスタック）'),
        d: z.boolean().describe('アイコンに D マークがある'),
        badge: z.enum(['SB', 'BB', 'none']),
        fold: z.boolean().describe('FOLD と表示されている'),
        bet: z.number().nullable().describe('この人の前に置かれたチップの数字（なければ null）'),
        act: ACTION.describe('アイコン付近の表示（RAISE / CALL / CHECK / BET / ALL IN / FOLD）。なければ none'),
      }),
    )
    .describe('先頭が自分。そこから画面上で時計回り（下→左→上→右）に全員。空席は入れない'),
});
export type ScreenRead = z.infer<typeof ScreenSchema>;

export const VISION_PROMPT = `これはテキサスホールデム（スマホアプリ）のゲーム画面です。縦長で、PCにミラーリングした画面をキャプチャしている場合があります（ウィンドウの枠や余白は無視）。
計算や推測はせず、画面に見えているものを正確に書き出してください。

- 画面いちばん下に大きく表示されている2枚が自分の手札。自分の席はその近くのアイコン。
- 各プレイヤー：アイコン、名前、名前の下の数字（残りスタック）。FOLD 表示はフォールド済み。
- アイコンの左上の小さな「D」マークがディーラー。「SB」「BB」の小さなバッジも見る。
- テーブル上で各プレイヤーの近くにある楕円の枠の数字が、その人の今のベット額。
- seats は自分を先頭に、画面上で時計回り（自分＝下 → 左側 → 上 → 右側）の順に並べる。名前は不要。
- JSONは改行や空白を入れず1行で出力する。
- カードは "As"（スペードのA）"Td"（ダイヤの10）の形式。s=♠ h=♥ d=♦ c=♣。
- 見えないものは null や空にする（推測で埋めない）。`;

export interface Converted {
  state: Partial<GameState>;
  warnings: string[];
}

function cards(xs: string[], what: string, warnings: string[]): string[] {
  const out: string[] = [];
  for (const x of xs) {
    const c = parseCard(x);
    if (c === null) warnings.push(`${what}「${x}」を読めませんでした`);
    else {
      const s = cardToString(c);
      if (!out.includes(s)) out.push(s);
    }
  }
  return out;
}

/** 読み取り結果 → アプリの局面 */
export function screenToState(r: ScreenRead, fallbackFormat: Format): Converted {
  const warnings: string[] = [];
  const seats = r.seats.slice(0, 9);
  const n = seats.length;
  const state: Partial<GameState> = {
    format: r.format === 'unknown' ? fallbackFormat : r.format,
    heroCards: cards(r.hero_cards, '手札', warnings),
    board: cards(r.board, 'ボード', warnings).slice(0, 5),
  };
  if (n < 2) {
    warnings.push('プレイヤーの席を読み取れませんでした');
    return { state, warnings };
  }
  const ordered = seats; // 先頭が自分

  // ディーラーの席：Dマーク → なければ SB/BB バッジから逆算
  let btn = ordered.findIndex((s) => s.d);
  const sbIdx = ordered.findIndex((s) => s.badge === 'SB');
  const bbIdx = ordered.findIndex((s) => s.badge === 'BB');
  if (btn < 0 && sbIdx >= 0) btn = n === 2 ? sbIdx : (sbIdx - 1 + n) % n;
  if (btn < 0 && bbIdx >= 0) btn = n === 2 ? (bbIdx + 1) % n : (bbIdx - 2 + n) % n;
  if (btn < 0) {
    warnings.push('ディーラー（D）が見つからないので、ポジションを確認してください');
    btn = 0;
  } else if (n > 2 && bbIdx >= 0 && (btn + 2) % n !== bbIdx) {
    warnings.push('DマークとBBバッジの位置が合いません（席の並びを確認してください）');
  }
  const posOf = (i: number) => positionOfSeat(i, btn, n);

  const bets = ordered.map((s) => (s.bet && s.bet > 0 ? s.bet : 0));
  const maxBet = Math.max(0, ...bets);
  const preflop = state.board!.length === 0;
  const hero = ordered[0];

  // BB額：画面の表示 → プリフロップならBBの人のベット or SBの2倍
  let bb = r.big_blind && r.big_blind > 0 ? r.big_blind : 0;
  if (!bb && preflop && bbIdx >= 0 && bets[bbIdx] > 0) bb = bets[bbIdx];
  if (!bb && preflop && sbIdx >= 0 && bets[sbIdx] > 0) bb = bets[sbIdx] * 2;
  if (!bb) {
    warnings.push('BB額が分からないので、金額をそのまま（1BB=1）扱います。局面欄で1BBの額を入れてください');
    bb = 1;
  }

  state.players = n;
  state.heroPosition = posOf(0);
  state.bigBlind = bb;
  state.pot = (r.center_pot ?? 0) + bets.reduce((a, b) => a + b, 0);
  state.toCall = Math.max(0, maxBet - bets[0]);
  state.heroStack = hero.stack ?? 100 * bb;

  // 参加している相手（自分以外・フォールドしていない・何か行動した／チップを入れた）
  const act = (s: (typeof ordered)[number]) => s.act;
  // プリフロップの行動順（UTG側が先）
  const order = positionsFor(n);
  const actOrder = (i: number) => order.indexOf(posOf(i));
  // レイズした人：RAISE/ALL IN 表示、または表示がなくてもBBより多く出していてコールではない人。
  // 同じ額を出している人の中でレイザーは1人だけ（表示がある人、なければ先に行動した人）
  const candidates = ordered
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => i > 0 && !s.fold && (act(s) === 'raise' || act(s) === 'allin' || (preflop && bets[i] > bb * 1.01 && act(s) !== 'call')));
  const byAmount = new Map<number, { s: (typeof ordered)[number]; i: number }[]>();
  for (const c of candidates) byAmount.set(bets[c.i], [...(byAmount.get(bets[c.i]) ?? []), c]);
  const raisers: { s: (typeof ordered)[number]; i: number }[] = [];
  const sameAmountCallers = new Set<number>();
  for (const group of byAmount.values()) {
    const labeled = group.filter(({ s }) => act(s) === 'raise' || act(s) === 'allin');
    const pick = (labeled.length ? labeled : group).sort((a, b) => actOrder(a.i) - actOrder(b.i))[0];
    raisers.push(pick);
    for (const g of group) if (g !== pick) sameAmountCallers.add(g.i);
  }
  // ベット額の小さい順に「オープン → 3ベット → 4ベット」
  raisers.sort((a, b) => bets[a.i] - bets[b.i]);
  const heroRaised = act(hero) === 'raise' || act(hero) === 'allin' || (preflop && bets[0] > bb * 1.01);
  const raiseCount = raisers.length + (heroRaised ? 1 : 0);

  const opponents: Opponent[] = [];
  ordered.forEach((s, i) => {
    if (i === 0 || s.fold) return;
    const p = posOf(i);
    let role: OpponentRole = 'unknown';
    if (preflop) {
      const k = raisers.findIndex((x) => x.i === i);
      if (k >= 0) {
        // 自分がオープンしていて相手がレイズ → 相手は3ベッター
        const order = k + (heroRaised && bets[0] < bets[i] ? 1 : 0);
        role = order === 0 ? 'opener' : order === 1 ? '3bettor' : '4bettor';
      } else if (act(s) === 'call' || sameAmountCallers.has(i)) role = raiseCount > 0 ? 'caller' : 'limper';
      else if ((p === 'SB' || p === 'BB') && act(s) === 'check') role = 'blind';
      else return; // まだ行動していない人は相手に含めない
    } else if (act(s) === 'none' && bets[i] === 0) {
      // フロップ以降：まだ行動していなくても、ハンドに残っている相手
      role = 'unknown';
    }
    opponents.push({ position: p, stack: s.stack, role });
  });
  state.opponents = opponents;

  if (preflop) {
    const limpers = opponents.some((o) => o.role === 'limper');
    const sc: PreflopScenario = raiseCount === 0 ? (limpers ? 'limped' : 'unopened') : raiseCount === 1 ? 'raised' : raiseCount === 2 ? '3bet' : '4bet';
    state.preflop = sc;
    // 最後に一番大きくレイズしたのが自分か
    state.heroIsAggressor = heroRaised && bets[0] >= maxBet;
    state.villainAction = 'none';
  } else {
    const villainActs = ordered.slice(1).filter((s) => !s.fold).map(act);
    const aggressive = villainActs.includes('raise') || villainActs.includes('allin');
    let va: StreetAction = 'none';
    if (maxBet > bets[0]) va = aggressive && bets[0] > 0 ? 'raise' : 'bet';
    else if (villainActs.includes('check')) va = 'check';
    state.villainAction = va;
  }
  if (!positionsFor(n).includes(state.heroPosition!)) warnings.push('自分のポジションを確認してください');
  return { state, warnings };
}

/**
 * 同じハンドの途中なら、前の読み取りから分かっていたこと（プリフロップの状況・相手の役割）を引き継ぐ。
 * フロップ以降の画面だけでは、誰がオープンしたかは分からないため。
 */
export function mergeWithPrevious(prev: GameState, next: GameState): GameState {
  const sameHand =
    prev.heroCards.length === 2 &&
    next.heroCards.length === 2 &&
    prev.heroCards.every((c) => next.heroCards.includes(c)) &&
    next.board.length >= prev.board.length &&
    prev.board.every((c, i) => next.board[i] === c);
  if (!sameHand || next.board.length === 0) return next;
  const roleOf = new Map(prev.opponents.map((o) => [o.position, o.role]));
  const merged: GameState = {
    ...next,
    opponents: next.opponents.map((o) => (o.role === 'unknown' && roleOf.has(o.position) ? { ...o, role: roleOf.get(o.position)! } : o)),
  };
  if (prev.board.length === 0) {
    // プリフロップ → フロップ：プリフロップの状況を引き継ぐ
    merged.preflop = prev.preflop;
    merged.heroIsAggressor = prev.heroIsAggressor;
    merged.villainBetsEarlier = 0;
  } else {
    merged.preflop = prev.preflop;
    merged.heroIsAggressor = prev.heroIsAggressor;
    const newStreet = next.board.length > prev.board.length;
    const bet = prev.villainAction === 'bet' || prev.villainAction === 'raise' ? 1 : 0;
    merged.villainBetsEarlier = newStreet ? prev.villainBetsEarlier + bet : prev.villainBetsEarlier;
  }
  return merged;
}
