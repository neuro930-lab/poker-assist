import { ALL_POSITIONS, type Position } from './positions';
import { ALL_HANDS } from './hands';

/** 色の定義。配列の並び（インデックス）がそのまま強さレベルになる（0 = 参加しない）。 */
export interface ColorDef {
  name: string;
  hex: string;
}

export interface Settings {
  /** 色の強さの順番（弱い順）と表示色 */
  colorOrder: ColorDef[];
  /** 169ハンド → 色名。未入力はグレー（レベル0）扱い */
  handColors: Record<string, string>;
  /** ポジション → 参加基準色名。未入力は未設定扱い */
  positionBaseColors: Partial<Record<Position, string>>;
  /** BBがコールできる最低色 */
  bbCallColor: string;
  /** リレイズ（3ベット）に必要な段数 */
  reraiseStep: number;
  /** 3ベットに対する4ベットに必要な段数（4ベットレンジ = R + reraiseStep + fourBetStep） */
  fourBetStep: number;
  /** 6人以下のとき、先頭（最初に行動する席）を「UTG」と表示する */
  labelFirstSeatAsUtg: boolean;
}

export const DEFAULT_COLORS: ColorDef[] = [
  { name: 'グレー', hex: '#d1d5db' },
  { name: '白', hex: '#ffffff' },
  { name: '水色', hex: '#7dd3fc' },
  { name: '緑', hex: '#4ade80' },
  { name: '黄', hex: '#facc15' },
  { name: '赤', hex: '#ef4444' },
  { name: '紺', hex: '#1e3a8a' },
];

/** レンジ表はヨコサワ氏の著作物のため同梱しない。ユーザーが設定画面で入力する。 */
export function defaultSettings(): Settings {
  return {
    colorOrder: DEFAULT_COLORS.map((c) => ({ ...c })),
    handColors: {},
    positionBaseColors: {},
    bbCallColor: '水色',
    reraiseStep: 2,
    fourBetStep: 2,
    labelFirstSeatAsUtg: false,
  };
}

export function maxLevel(s: Settings): number {
  return s.colorOrder.length - 1;
}

/** 色名 → レベル。不明な色名は undefined */
export function levelOf(s: Settings, colorName: string | undefined): number | undefined {
  if (colorName === undefined) return undefined;
  const i = s.colorOrder.findIndex((c) => c.name === colorName);
  return i < 0 ? undefined : i;
}

export function colorAt(s: Settings, level: number): ColorDef {
  const i = Math.max(0, Math.min(level, maxLevel(s)));
  return s.colorOrder[i];
}

/** 手札のレベル。未入力・不明な色はグレー（0）扱い */
export function handLevel(s: Settings, hand: string): number {
  return levelOf(s, s.handColors[hand]) ?? 0;
}

/** ポジションの基準レベル。未設定は undefined */
export function positionLevel(s: Settings, pos: Position): number | undefined {
  return levelOf(s, s.positionBaseColors[pos]);
}

// ---- 永続化 ----

const STORAGE_KEY = 'poker-assist.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultSettings();
    return parseSettings(JSON.parse(raw)).settings;
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // 保存できない環境（プライベートモード等）では何もしない
  }
}

export function exportSettings(s: Settings): string {
  return JSON.stringify(s, null, 2);
}

/**
 * JSON（読み込みファイル・ローカルストレージ）を検証して Settings にする。
 * 欠けている項目は初期値で補い、不正な値は捨てて warnings に記録する。
 */
export function parseSettings(data: unknown): { settings: Settings; warnings: string[] } {
  const warnings: string[] = [];
  const base = defaultSettings();
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('設定ファイルの形式が正しくありません（JSONオブジェクトではありません）');
  }
  const d = data as Record<string, unknown>;

  let colorOrder = base.colorOrder;
  if (Array.isArray(d.colorOrder)) {
    const parsed = d.colorOrder.filter(
      (c): c is ColorDef =>
        typeof c === 'object' && c !== null &&
        typeof (c as ColorDef).name === 'string' && typeof (c as ColorDef).hex === 'string',
    );
    const names = new Set(parsed.map((c) => c.name));
    if (parsed.length >= 2 && names.size === parsed.length) {
      colorOrder = parsed.map((c) => ({ name: c.name, hex: c.hex }));
    } else {
      warnings.push('colorOrder が不正なため初期値を使います');
    }
  }
  const s: Settings = { ...base, colorOrder };
  const validColor = (v: unknown): v is string =>
    typeof v === 'string' && colorOrder.some((c) => c.name === v);

  if (typeof d.handColors === 'object' && d.handColors !== null) {
    const hands = new Set(ALL_HANDS);
    for (const [hand, color] of Object.entries(d.handColors as Record<string, unknown>)) {
      if (!hands.has(hand)) warnings.push(`不明なハンド「${hand}」を無視しました`);
      else if (!validColor(color)) warnings.push(`${hand} の色「${String(color)}」が不明なのでグレー扱いにします`);
      else s.handColors[hand] = color;
    }
  }
  if (typeof d.positionBaseColors === 'object' && d.positionBaseColors !== null) {
    for (const [pos, color] of Object.entries(d.positionBaseColors as Record<string, unknown>)) {
      if (!(ALL_POSITIONS as readonly string[]).includes(pos)) warnings.push(`不明なポジション「${pos}」を無視しました`);
      else if (!validColor(color)) warnings.push(`${pos} の基準色「${String(color)}」が不明なので未設定にします`);
      else s.positionBaseColors[pos as Position] = color;
    }
  }
  if (d.bbCallColor !== undefined) {
    if (validColor(d.bbCallColor)) s.bbCallColor = d.bbCallColor;
    else warnings.push('bbCallColor が不明な色なので初期値を使います');
  }
  if (!validColor(s.bbCallColor)) s.bbCallColor = colorOrder[Math.min(2, colorOrder.length - 1)].name;
  for (const key of ['reraiseStep', 'fourBetStep'] as const) {
    const v = d[key];
    if (v === undefined) continue;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1) s[key] = v;
    else warnings.push(`${key} は1以上の整数にしてください（初期値を使います）`);
  }
  if (typeof d.labelFirstSeatAsUtg === 'boolean') s.labelFirstSeatAsUtg = d.labelFirstSeatAsUtg;
  return { settings: s, warnings };
}
