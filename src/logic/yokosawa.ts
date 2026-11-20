import { ALL_HANDS, RANKS } from './hands';
import type { Position } from './positions';
import type { ColorDef, Settings } from './settings';

export type Format = 'ring' | 'tournament';

export const FORMAT_LABELS: Record<Format, string> = {
  ring: 'リングゲーム',
  tournament: 'トーナメント',
};

/**
 * ヨコサワハンドレンジ表（ユーザー提供の画像から転記）。
 * 行 = 1枚目のランク（A→2）、列 = 2枚目のランク（A→2）。右上がスーテッド、左下がオフスート。
 * P=紫 R=赤 Y=黄 G=緑 C=水色 W=白 B=BTN／BB枠（グレー＋ピンク枠） K=ピンク .=グレー
 */
const CHART_ROWS: Record<Format, string[]> = {
  ring: [
    'PPRRRGGGGGGGG',
    'PPRYGGWWWWWWW',
    'RYPYGCWWWBBBB',
    'YGCRYCWWB....',
    'GCWCRGCBB....',
    'CWWWWRCWB....',
    'W....BYWB....',
    'W......YWB...',
    'B.......GWB..',
    '.........GB..',
    '..........C..',
    '...........C.',
    '............C',
  ],
  tournament: [
    'PPRRRGGGGGGGG',
    'PPRYGGWWWWWWW',
    'RYPYGCWWWBBBB',
    'YGCRYCWWBKKKK',
    'GCWCRGCBBKKKK',
    'CWWWWRCWBK...',
    'WKKKKBYWBK...',
    'WKK..KKYWBK..',
    'BK......GWBK.',
    'KK.......GBK.',
    'K.........CK.',
    'K..........C.',
    'K...........C',
  ],
};

interface Tier {
  code: string;
  color: ColorDef;
  /** 表の凡例の説明 */
  meaning: string;
}

const PINK = '#e6007e';

const TIERS: Record<Format, Tier[]> = {
  ring: [
    { code: '.', color: { name: 'グレー', hex: '#c8ccd2' }, meaning: 'フォールド' },
    { code: 'B', color: { name: 'BB枠', hex: '#c8ccd2', outline: PINK }, meaning: 'BBのみBTNのレイズにコールOK' },
    { code: 'W', color: { name: '白', hex: '#ffffff' }, meaning: 'BTN（後ろに0〜2人）' },
    { code: 'C', color: { name: '水色', hex: '#7cc8ef' }, meaning: 'CO（後ろに3人）' },
    { code: 'G', color: { name: '緑', hex: '#5cb531' }, meaning: 'LJ・HJ（後ろに4〜5人）' },
    { code: 'Y', color: { name: '黄', hex: '#f9c80e' }, meaning: 'EP（後ろに6〜7人）' },
    { code: 'R', color: { name: '赤', hex: '#e60012' }, meaning: 'UTG（後ろに8人）' },
    { code: 'P', color: { name: '紫', hex: '#8c7cc0' }, meaning: 'UTG（後ろに8人）の強ハンド' },
  ],
  tournament: [
    { code: '.', color: { name: 'グレー', hex: '#c8ccd2' }, meaning: 'フォールド' },
    { code: 'K', color: { name: 'ピンク', hex: '#f6c6dc' }, meaning: 'BBのみBTNのレイズにコールOK' },
    { code: 'B', color: { name: 'BTN枠', hex: '#c8ccd2', outline: PINK }, meaning: 'BTN（後ろに0〜2人）' },
    { code: 'W', color: { name: '白', hex: '#ffffff' }, meaning: 'CO（後ろに3人）' },
    { code: 'C', color: { name: '水色', hex: '#7cc8ef' }, meaning: 'LJ・HJ（後ろに4〜5人）' },
    { code: 'G', color: { name: '緑', hex: '#5cb531' }, meaning: 'EP（後ろに6〜7人）' },
    { code: 'Y', color: { name: '黄', hex: '#f9c80e' }, meaning: 'UTG（後ろに8人）の弱ハンド' },
    { code: 'R', color: { name: '赤', hex: '#e60012' }, meaning: 'UTG（後ろに8人）の中ハンド' },
    { code: 'P', color: { name: '紫', hex: '#8c7cc0' }, meaning: 'UTG（後ろに8人）の強ハンド' },
  ],
};

const POSITION_BASE: Record<Format, Partial<Record<Position, string>>> = {
  ring: { UTG: '赤', 'UTG+1': '黄', MP: '黄', LJ: '緑', HJ: '緑', CO: '水色', BTN: '白', SB: '白' },
  tournament: {
    UTG: '黄', 'UTG+1': '緑', MP: '緑', LJ: '水色', HJ: '水色', CO: '白', BTN: 'BTN枠', SB: 'BTN枠',
  },
};

/** ハンド名 → 表のコード */
export function chartCode(format: Format, hand: string): string {
  const r1 = RANKS.indexOf(hand[0] as (typeof RANKS)[number]);
  const r2 = RANKS.indexOf(hand[1] as (typeof RANKS)[number]);
  if (hand.length === 2) return CHART_ROWS[format][r1][r1];
  // スーテッドは右上（行 < 列）、オフスートは左下（行 > 列）
  return hand.endsWith('s') ? CHART_ROWS[format][r1][r2] : CHART_ROWS[format][r2][r1];
}

export function tierMeanings(format: Format): { name: string; meaning: string }[] {
  return TIERS[format].map((t) => ({ name: t.color.name, meaning: t.meaning }));
}

/** ヨコサワ表をそのまま Settings にしたもの（設定画面で編集可能な初期値） */
export function yokosawaSettings(format: Format): Settings {
  const tiers = TIERS[format];
  const handColors: Record<string, string> = {};
  for (const hand of ALL_HANDS) {
    const code = chartCode(format, hand);
    const tier = tiers.find((t) => t.code === code);
    if (!tier) throw new Error(`unknown chart code ${code} for ${hand}`);
    if (tier.code !== '.') handColors[hand] = tier.color.name;
  }
  return {
    colorOrder: tiers.map((t) => ({ ...t.color })),
    handColors,
    positionBaseColors: { ...POSITION_BASE[format] },
    bbDefendSteps: 1,
    reraiseStep: 2,
    fourBetStep: 2,
    labelFirstSeatAsUtg: false,
  };
}
