import { describe, expect, it } from 'vitest';
import { parseCard, parseCards, handClass, combosOfClass, cardToString } from './cards';
import { evaluate, categoryOf } from './evaluator';
import { computeEquity, anyTwoCards } from './equity';
import { analyzeDraws, analyzeMadeHand, analyzeTexture } from './analysis';
import { advise } from './advisor';
import { emptyState, type GameState } from './state';
import { defaultSettings } from '../logic/settings';
import { postflopOrder, seatOfPosition, positionOfSeat } from '../logic/positions';

const C = (t: string) => parseCards(t);
const ev = (t: string) => evaluate(C(t));
const settings = { ring: defaultSettings('ring'), tournament: defaultSettings('tournament') };

describe('cards', () => {
  it('いろいろな表記を読める', () => {
    expect(cardToString(parseCard('As')!)).toBe('As');
    expect(cardToString(parseCard('10h')!)).toBe('Th');
    expect(cardToString(parseCard('k♦')!)).toBe('Kd');
    expect(parseCard('Xx')).toBeNull();
    expect(C('A♠ K♦ 7c').map(cardToString)).toEqual(['As', 'Kd', '7c']);
  });
  it('169ハンド名', () => {
    expect(handClass(parseCard('Ks')!, parseCard('As')!)).toBe('AKs');
    expect(handClass(parseCard('7d')!, parseCard('7c')!)).toBe('77');
    expect(combosOfClass('AKo')).toHaveLength(12);
  });
});

describe('evaluator', () => {
  it('役の強さの順番', () => {
    const order = [
      'As Kd 9c 7h 3s 2d 4c', // ハイカード
      'As Ad 9c 7h 3s', // ワンペア
      'As Ad 9c 9h 3s', // ツーペア
      'As Ad Ac 9h 3s', // スリーカード
      'As 2d 3c 4h 5s', // ホイール
      '6s 2d 3c 4h 5s', // 6ハイストレート
      'As Js 9s 7s 3s', // フラッシュ
      'As Ad Ac 9h 9s', // フルハウス
      'As Ad Ac Ah 9s', // フォーカード
      'As 2s 3s 4s 5s', // ストレートフラッシュ
    ].map(ev);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
    expect(categoryOf(ev('As 2s 3s 4s 5s'))).toBe(8);
  });
  it('7枚から最強の5枚、キッカー比較、引き分け', () => {
    expect(ev('As Ad Kc 9h 3s 2d 4c')).toBeGreaterThan(ev('Ah Ac Qc 9h 3s 2d 4c'));
    expect(ev('As Kd 9c 9h 3s 3d 2c')).toBe(ev('Ah Kc 9d 9s 3h 3c 2d'));
    expect(categoryOf(ev('As Ad Ac Kh Ks Kc 2d'))).toBe(6);
  });
});

describe('equity', () => {
  it('AA vs KK はおよそ82%', () => {
    const kk = combosOfClass('KK').map(([c1, c2]) => ({ c1, c2, w: 1 }));
    const r = computeEquity([parseCard('As')!, parseCard('Ah')!], [], [kk], { iterations: 20000 });
    expect(r.equity).toBeGreaterThan(0.79);
    expect(r.equity).toBeLessThan(0.85);
  });
  it('リバーは厳密計算', () => {
    const r = computeEquity([parseCard('As')!, parseCard('Ks')!], C('Qs Js Ts 2d 3c'), [anyTwoCards()]);
    expect(r.exact).toBe(true);
    expect(r.equity).toBe(1); // ロイヤルフラッシュ
  });
});

describe('analysis', () => {
  it('手役の説明', () => {
    const h = (t: string) => C(t) as [number, number];
    expect(analyzeMadeHand(h('Ah Kd'), C('Ks 7c 2d')).label).toContain('トップペア');
    expect(analyzeMadeHand(h('Qh Qd'), C('Js 7c 2d')).label).toContain('オーバーペア');
    expect(analyzeMadeHand(h('7h 7d'), C('7s Kc 2d')).label).toContain('セット');
  });
  it('ドローとアウツ', () => {
    const fd = analyzeDraws(C('Ah 5h') as [number, number], C('Kh 9h 2c'));
    expect(fd.flushDraw).toBe(true);
    expect(fd.nutFlushDraw).toBe(true);
    expect(fd.outs).toBe(9);
    const oesd = analyzeDraws(C('9c 8d') as [number, number], C('7h 6s 2c'));
    expect(oesd.oesd).toBe(true);
    expect(oesd.outs).toBe(8);
    const gut = analyzeDraws(C('9c 8d') as [number, number], C('Jh 7s 2c'));
    expect(gut.gutshot).toBe(true);
    expect(gut.outs).toBe(4);
  });
  it('ボードのテクスチャ', () => {
    expect(analyzeTexture(C('Ks 7c 2d')).label).toContain('ドライ');
    expect(analyzeTexture(C('Jh Th 9h')).wetness).toBeGreaterThan(0.55);
  });
});

describe('positions（追加分）', () => {
  it('ポジション ↔ 座席', () => {
    for (const p of ['UTG', 'HJ', 'BTN', 'SB', 'BB'] as const) {
      expect(positionOfSeat(seatOfPosition(p, 9)!, 0, 9)).toBe(p);
    }
  });
  it('フロップ以降はSBが最初、BTNが最後', () => {
    expect(postflopOrder('SB', 6)).toBe(0);
    expect(postflopOrder('BTN', 6)).toBe(5);
    expect(postflopOrder('BB', 2)).toBe(0);
  });
});

function st(p: Partial<GameState>): GameState {
  return { ...emptyState('ring'), players: 9, ...p };
}

describe('advisor', () => {
  it('入力不足', () => {
    expect(advise(st({}), settings).status).toBe('incomplete');
  });
  it('プリフロップ：UTGのAA → レイズ、72o → フォールド', () => {
    expect(advise(st({ heroPosition: 'UTG', heroCards: ['As', 'Ad'] }), settings).action).toBe('raise');
    const f = advise(st({ heroPosition: 'UTG', heroCards: ['7s', '2d'] }), settings);
    expect(f.action).toBe('fold');
    expect(f.yokosawa?.colorName).toBe('グレー');
  });
  it('プリフロップ：HJのオープンにBTNでAQs（赤＝2つ上）→ 3ベット', () => {
    const a = advise(st({
      heroPosition: 'BTN', heroCards: ['As', 'Qs'], preflop: 'raised', pot: 4, toCall: 2.5,
      opponents: [{ position: 'HJ', stack: 100, role: 'opener' }],
    }), settings);
    expect(a.action).toBe('raise');
    expect(a.highlightHands).toContain('ATs');
  });
  it('ショートスタック：BTN 8BBでA9o → オールイン、72o → フォールド', () => {
    const base = { format: 'tournament' as const, heroPosition: 'BTN' as const, heroStack: 8, pot: 1.5 };
    expect(advise(st({ ...base, heroCards: ['Ac', '9d'] }), settings).action).toBe('allin');
    expect(advise(st({ ...base, heroCards: ['7c', '2d'] }), settings).action).toBe('fold');
  });
  it('フロップ：トップペア良キッカーはバリューベット、空振りはチェック', () => {
    const base = {
      preflop: 'raised' as const, heroIsAggressor: true, heroPosition: 'BTN' as const,
      board: ['Ks', '7c', '2d'], pot: 6, toCall: 0, villainAction: 'check' as const,
      opponents: [{ position: 'BB' as const, stack: 97, role: 'caller' as const }],
    };
    expect(advise(st({ ...base, heroCards: ['Ah', 'Kd'] }), settings).action).toBe('bet');
    const air = advise(st({ ...base, board: ['9s', '8s', '6c'], heroCards: ['Ah', '2d'] }), settings);
    expect(air.action).toBe('check');
  });
  it('リバー：大きなベットにボトムペアはフォールド、ナッツはレイズ', () => {
    const base = {
      preflop: 'raised' as const, heroPosition: 'BB' as const, board: ['Ks', 'Qd', '7c', '4h', '2s'],
      pot: 40, toCall: 20, villainAction: 'bet' as const, villainBetsEarlier: 2,
      opponents: [{ position: 'CO' as const, stack: 60, role: 'opener' as const }],
    };
    expect(advise(st({ ...base, heroCards: ['2h', '3h'] }), settings).action).toBe('fold');
    const nuts = advise(st({ ...base, heroCards: ['Kh', 'Kd'] }), settings);
    expect(['raise', 'allin']).toContain(nuts.action);
  });
  it('BBのエンジン補正：表ではフォールドでもオッズが良ければコール、悪ければフォールド', () => {
    const base = {
      format: 'tournament' as const, players: 6, heroPosition: 'BB' as const, heroCards: ['6h', '5c'],
      preflop: 'raised' as const, heroStack: 24, opponents: [{ position: 'CO' as const, stack: 17.5, role: 'opener' as const }],
    };
    expect(advise(st({ ...base, pot: 5, toCall: 1.5 }), settings).action).toBe('call');
    expect(advise(st({ ...base, heroCards: ['7h', '2c'], pot: 5, toCall: 1.5 }), settings).action).toBe('fold');
    expect(advise(st({ ...base, pot: 8, toCall: 5 }), settings).action).toBe('fold');
  });
  it('ドローのコール：ポットオッズが合えばコール', () => {
    const a = advise(st({
      preflop: 'raised', heroPosition: 'BTN', heroCards: ['Ah', '5h'], board: ['Kh', '9h', '2c'],
      pot: 9, toCall: 3, villainAction: 'bet', opponents: [{ position: 'HJ', stack: 95, role: 'opener' }],
    }), settings);
    expect(['call', 'raise']).toContain(a.action);
  });
});
