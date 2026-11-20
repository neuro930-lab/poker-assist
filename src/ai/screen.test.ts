import { describe, expect, it } from 'vitest';
import { mergeWithPrevious, screenToState, type ScreenRead } from './screen';
import { parseScreenJson } from './local';
import { emptyState, type GameState } from '../engine/state';

type Seat = ScreenRead['seats'][number];
const seat = (p: Partial<Seat>): Seat => ({
  stack: 4000, d: false, badge: 'none', fold: false, bet: null, act: 'none', ...p,
});

/** ユーザー提供のスクショ：自分BB(65o)、yukke が500にレイズ、SBはまだ行動していない */
const screenshot: ScreenRead = {
  is_poker_table: true, hand_in_progress: true, is_hero_turn: false, notes: '', format: 'tournament',
  hero_cards: ['6h', '5c'], board: [], center_pot: 200, big_blind: null,
  seats: [
    seat({ stack: 4800, badge: 'BB', bet: 200 }), // 自分
    seat({ fold: true, act: 'fold' }), // おにぎり明太子
    seat({ fold: true, act: 'fold' }), // 夜風
    seat({ stack: 3500, bet: 500, act: 'raise' }), // yukke
    seat({ stack: 3900, d: true, fold: true, act: 'fold' }), // たけのこ
    seat({ stack: 2800, badge: 'SB', bet: 100 }), // とよちゃん
  ],
};

describe('screenToState', () => {
  it('スクショの局面：ポジション・BB・ポット・コール額・レイザー', () => {
    const { state, warnings } = screenToState(screenshot, 'ring');
    expect(warnings).toEqual([]);
    expect(state.format).toBe('tournament');
    expect(state.players).toBe(6);
    expect(state.heroPosition).toBe('BB');
    expect(state.bigBlind).toBe(200);
    expect(state.pot).toBe(1000);
    expect(state.toCall).toBe(300);
    expect(state.heroStack).toBe(4800);
    expect(state.preflop).toBe('raised');
    expect(state.heroIsAggressor).toBe(false);
    expect(state.opponents).toEqual([{ position: 'CO', stack: 3500, role: 'opener' }]); // SBはまだ行動していない
  });
  it('Dマークが見えなくても、SB/BBバッジから計算できる', () => {
    const seats = screenshot.seats.map((s) => ({ ...s, d: false }));
    const { state } = screenToState({ ...screenshot, seats }, 'ring');
    expect(state.heroPosition).toBe('BB');
    expect(state.opponents?.[0].position).toBe('CO');
  });
  it('RAISE表示がなくても、同じ額の2人はオープンとコール', () => {
    const s2: ScreenRead = {
      ...screenshot,
      seats: screenshot.seats.map((s, i) =>
        i === 3 ? { ...s, act: 'none' as const } : i === 4 ? { ...s, fold: false, act: 'none' as const, bet: 500 } : s,
      ),
    };
    const { state } = screenToState(s2, 'ring');
    expect(state.preflop).toBe('raised');
    expect(state.opponents).toEqual([
      { position: 'CO', stack: 3500, role: 'opener' },
      { position: 'BTN', stack: 3900, role: 'caller' },
    ]);
  });
  it('自分がオープン→相手が3ベット', () => {
    const s3: ScreenRead = {
      ...screenshot,
      seats: screenshot.seats.map((s, i) => (i === 0 ? { ...s, bet: 500, act: 'raise' as const } : i === 3 ? { ...s, bet: 1500 } : s)),
    };
    const { state } = screenToState(s3, 'ring');
    expect(state.preflop).toBe('3bet');
    expect(state.heroIsAggressor).toBe(false);
    expect(state.opponents?.[0].role).toBe('3bettor');
    expect(state.toCall).toBe(1000);
  });
  it('フロップで相手がベット', () => {
    const flop: ScreenRead = {
      ...screenshot, board: ['Kh', '7c', '2d'], center_pot: 1100, big_blind: 200,
      seats: screenshot.seats.map((s, i) =>
        i === 0 ? { ...s, bet: null } : i === 3 ? { ...s, bet: 400, act: 'bet' as const } : i === 5 ? { ...s, fold: true, bet: null } : s,
      ),
    };
    const { state } = screenToState(flop, 'ring');
    expect(state.pot).toBe(1500);
    expect(state.toCall).toBe(400);
    expect(state.villainAction).toBe('bet');
    expect(state.opponents?.map((o) => o.position)).toEqual(['CO']);
  });
});

describe('mergeWithPrevious', () => {
  const pre: GameState = {
    ...emptyState('tournament'), players: 6, heroPosition: 'BB', heroCards: ['6h', '5c'], board: [],
    preflop: 'raised', opponents: [{ position: 'CO', stack: 3500, role: 'opener' }],
  };
  it('同じハンドのフロップでは、プリフロップの状況と役割を引き継ぐ', () => {
    const flop: GameState = { ...pre, board: ['Kh', '7c', '2d'], preflop: 'unopened', opponents: [{ position: 'CO', stack: 3000, role: 'unknown' }], villainAction: 'bet' };
    const m = mergeWithPrevious(pre, flop);
    expect(m.preflop).toBe('raised');
    expect(m.opponents[0]).toEqual({ position: 'CO', stack: 3000, role: 'opener' });
    const turn = mergeWithPrevious(m, { ...flop, board: ['Kh', '7c', '2d', '9s'], villainAction: 'none' });
    expect(turn.villainBetsEarlier).toBe(1);
  });
  it('別のハンドなら引き継がない', () => {
    const other: GameState = { ...pre, heroCards: ['As', 'Kd'], board: ['Kh', '7c', '2d'], preflop: 'unopened' };
    expect(mergeWithPrevious(pre, other).preflop).toBe('unopened');
  });
});

describe('parseScreenJson', () => {
  it('コードブロックや前後の文があっても読み、おかしい項目は既定値に', () => {
    const r = parseScreenJson('結果です\n```json\n{"hand_in_progress":true,"hero_cards":["6h","5c"],"format":"???","seats":[{"stack":100,"badge":"XX"}]}\n```');
    expect(r.hand_in_progress).toBe(true);
    expect(r.format).toBe('unknown');
    expect(r.seats[0].badge).toBe('none');
    expect(r.seats[0].stack).toBe(100);
  });
});
