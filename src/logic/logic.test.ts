import { describe, expect, it } from 'vitest';
import { decide, isSelectableOpponent, buildRange, type DecisionInput } from './decide';
import { ALL_HANDS, TOTAL_COMBOS, combosOf, handAt } from './hands';
import { actionIndex, nextButton, positionOfSeat, positionsFor, displayName } from './positions';
import { defaultSettings, parseSettings, handLevel, type Settings } from './settings';

/** テスト専用の色データ（実際のヨコサワ表ではない） */
function testSettings(): Settings {
  const s = defaultSettings();
  s.positionBaseColors = {
    UTG: '赤', 'UTG+1': '黄', MP: '黄', LJ: '緑', HJ: '緑', CO: '水色', BTN: '白', SB: '水色',
  };
  s.handColors = {
    AA: '紺', KK: '紺', AKs: '赤', QQ: '赤', AKo: '黄', JJ: '黄', AQs: '黄',
    TT: '緑', KQs: '緑', '99': '水色', A5s: '水色', K9o: '白', '72o': 'グレー',
  };
  return s;
}

/** 9人テーブル、BTN=座席6 のとき：座席0=UTG … 5=CO, 6=BTN, 7=SB, 8=BB */
function input(partial: Partial<DecisionInput>): DecisionInput {
  return {
    players: 9, btnSeat: 6, mySeat: null, hand: null, opponentSeat: null,
    situation: 'normal', settings: testSettings(), ...partial,
  };
}
const SEAT = { UTG: 0, LJ: 3, HJ: 4, CO: 5, BTN: 6, SB: 7, BB: 8 };

describe('hands', () => {
  it('169ハンド・1326通り', () => {
    expect(new Set(ALL_HANDS).size).toBe(169);
    expect(ALL_HANDS.reduce((a, h) => a + combosOf(h), 0)).toBe(TOTAL_COMBOS);
  });
  it('右上がスーテッド、左下がオフスート', () => {
    expect(handAt(0, 0)).toBe('AA');
    expect(handAt(0, 1)).toBe('AKs');
    expect(handAt(1, 0)).toBe('AKo');
    expect(handAt(12, 11)).toBe('32o');
  });
  it('未入力ハンドはグレー（0）', () => {
    expect(handLevel(testSettings(), '83o')).toBe(0);
  });
});

describe('positions', () => {
  it('人数ごとのポジション', () => {
    expect(positionsFor(9)).toEqual(['UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(positionsFor(6)).toEqual(['LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB']);
    expect(positionsFor(3)).toEqual(['BTN', 'SB', 'BB']);
    expect(positionsFor(2)).toEqual(['BTN', 'BB']);
  });
  it('座席 → ポジション（BTNの次がSB、その次がBB）', () => {
    expect(positionOfSeat(6, 6, 9)).toBe('BTN');
    expect(positionOfSeat(7, 6, 9)).toBe('SB');
    expect(positionOfSeat(8, 6, 9)).toBe('BB');
    expect(positionOfSeat(0, 6, 9)).toBe('UTG');
    expect(positionOfSeat(5, 6, 9)).toBe('CO');
    // 6人、BTN=座席0
    expect([0, 1, 2, 3, 4, 5].map((s) => positionOfSeat(s, 0, 6))).toEqual(['BTN', 'SB', 'BB', 'LJ', 'HJ', 'CO']);
  });
  it('2人：BTN(=SB)が先に行動、相手がBB', () => {
    expect(positionOfSeat(1, 1, 2)).toBe('BTN');
    expect(positionOfSeat(0, 1, 2)).toBe('BB');
    expect(actionIndex(1, 1, 2)).toBe(0);
    expect(displayName('BTN', 2, false)).toBe('BTN/SB');
  });
  it('次のハンドでBTNが時計回りに1つ進む（一周する）', () => {
    expect(nextButton(6, 9)).toBe(7);
    expect(nextButton(8, 9)).toBe(0);
    expect(nextButton(0, 2)).toBe(1);
    expect(nextButton(1, 2)).toBe(0);
    // 自分の席は固定、ポジションが1つずつ前に回る
    expect(positionOfSeat(8, nextButton(6, 9), 9)).toBe('SB');
  });
  it('先頭をUTGと表示する設定', () => {
    expect(displayName('LJ', 6, true)).toBe('UTG');
    expect(displayName('LJ', 6, false)).toBe('LJ');
    expect(displayName('HJ', 6, true)).toBe('HJ');
  });
});

describe('相手として選べる座席', () => {
  it('オープン／vsレイズでは自分より後ろの席は選べない', () => {
    expect(isSelectableOpponent(SEAT.CO, SEAT.BTN, 6, 9, 'normal')).toBe(true);
    expect(isSelectableOpponent(SEAT.SB, SEAT.BTN, 6, 9, 'normal')).toBe(false);
    expect(isSelectableOpponent(SEAT.BTN, SEAT.BTN, 6, 9, 'normal')).toBe(false);
  });
  it('vs3ベットでは自分より後ろの席だけ選べる', () => {
    expect(isSelectableOpponent(SEAT.SB, SEAT.CO, 6, 9, 'vs3bet')).toBe(true);
    expect(isSelectableOpponent(SEAT.LJ, SEAT.CO, 6, 9, 'vs3bet')).toBe(false);
  });
});

describe('オープン判定', () => {
  it('H ≧ P → レイズ、H ＜ P → フォールド', () => {
    expect(decide(input({ mySeat: SEAT.CO, hand: '99' })).action).toBe('raise'); // 水色 ≧ 水色
    expect(decide(input({ mySeat: SEAT.CO, hand: 'K9o' })).action).toBe('fold'); // 白 ＜ 水色
  });
  it('BBで全員フォールド → チェック（勝ち）', () => {
    expect(decide(input({ mySeat: SEAT.BB, hand: '72o' })).action).toBe('check');
  });
  it('基準色が未設定なら判定しない', () => {
    const s = testSettings();
    delete s.positionBaseColors.CO;
    const d = decide(input({ mySeat: SEAT.CO, hand: 'AA', settings: s }));
    expect(d.status).toBe('incomplete');
    expect(d.warnings.length).toBeGreaterThan(0);
  });
});

describe('vsレイズ判定', () => {
  it('例：CO（水色）がレイズ、BTNの手札が緑 → 1つ上でコール', () => {
    const d = decide(input({ mySeat: SEAT.BTN, hand: 'TT', opponentSeat: SEAT.CO }));
    expect(d.action).toBe('call');
    expect(d.reason).toContain('1つ上');
    expect(d.opponentRange?.text).toBe('水色以上');
  });
  it('2つ以上上 → 3ベット', () => {
    expect(decide(input({ mySeat: SEAT.BTN, hand: 'JJ', opponentSeat: SEAT.CO })).action).toBe('3bet');
  });
  it('同じ色 → フォールド', () => {
    expect(decide(input({ mySeat: SEAT.BTN, hand: '99', opponentSeat: SEAT.CO })).action).toBe('fold');
  });
});

describe('BB判定', () => {
  it('2つ上 → 3ベット', () => {
    expect(decide(input({ mySeat: SEAT.BB, hand: 'AKs', opponentSeat: SEAT.HJ })).action).toBe('3bet'); // 赤 vs 緑
  });
  it('水色以上ならどこからでもコール（通常判定も併記）', () => {
    const d = decide(input({ mySeat: SEAT.BB, hand: 'A5s', opponentSeat: SEAT.UTG }));
    expect(d.action).toBe('call');
    expect(d.notes.join()).toContain('フォールド');
  });
  it('水色未満 → フォールド', () => {
    expect(decide(input({ mySeat: SEAT.BB, hand: 'K9o', opponentSeat: SEAT.BTN })).action).toBe('fold');
  });
  it('BBのコール基準色は設定で変更できる', () => {
    const s = testSettings();
    s.bbCallColor = '白';
    expect(decide(input({ mySeat: SEAT.BB, hand: 'K9o', opponentSeat: SEAT.UTG, settings: s })).action).toBe('call');
  });
});

describe('vs3ベット／vs4ベット', () => {
  it('例：COでオープン → 3ベットされた → 相手は黄以上', () => {
    const d = decide(input({ mySeat: SEAT.CO, hand: 'TT', situation: 'vs3bet', opponentSeat: SEAT.BTN }));
    expect(d.status).toBe('rangeOnly');
    expect(d.action).toBeUndefined();
    expect(d.opponentRange?.text).toBe('黄以上');
    expect(d.opponentRange?.label).toContain('BTN');
  });
  it('紺を超えたら「紺のみ」', () => {
    const d = decide(input({ mySeat: SEAT.UTG, situation: 'vs3bet' })); // 赤(5)+2=7
    expect(d.opponentRange?.text).toBe('紺のみ');
    expect(d.opponentRange?.hands.sort()).toEqual(['AA', 'KK']);
  });
  it('vs4ベット：相手の4ベット = R+4 以上', () => {
    // 相手CO（水色2）→ 3ベット下限は黄(4)、4ベットは紺(6)
    const d = decide(input({ mySeat: SEAT.BTN, situation: 'vs4bet', opponentSeat: SEAT.CO }));
    expect(d.opponentRange?.text).toBe('紺のみ');
    expect(d.reason).toContain('黄以上');
  });
  it('4ベットの段数は設定で変更できる', () => {
    const s = testSettings();
    s.fourBetStep = 1;
    const d = decide(input({ mySeat: SEAT.BTN, situation: 'vs4bet', opponentSeat: SEAT.CO, settings: s }));
    expect(d.opponentRange?.text).toBe('赤以上');
  });
});

describe('想定レンジの割合', () => {
  it('AAのみ = 6/1326 ≒ 0.45%', () => {
    const s = defaultSettings();
    s.handColors = { AA: '紺' };
    const r = buildRange(s, 6, 'x');
    expect(r.combos).toBe(6);
    expect(r.percent).toBeCloseTo(0.452, 2);
  });
  it('グレーはレンジに含めない', () => {
    const r = buildRange(testSettings(), 0, 'x');
    expect(r.hands).not.toContain('72o');
    expect(r.hands).not.toContain('83o');
  });
});

describe('設定の読み込み', () => {
  it('不明な色・ハンドは警告して捨てる', () => {
    const { settings, warnings } = parseSettings({
      handColors: { AKs: '赤', XYz: '赤', QQ: '紫' },
      positionBaseColors: { BTN: '白' },
      reraiseStep: 0,
    });
    expect(settings.handColors).toEqual({ AKs: '赤' });
    expect(settings.positionBaseColors.BTN).toBe('白');
    expect(settings.reraiseStep).toBe(2);
    expect(warnings.length).toBe(3);
  });
  it('オブジェクト以外はエラー', () => {
    expect(() => parseSettings([1, 2])).toThrow();
  });
});
