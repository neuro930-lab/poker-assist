import { ALL_POSITIONS, type Position } from './positions';
import { ALL_HANDS } from './hands';
import { yokosawaSettings, type Format } from './yokosawa';

/** 色の定義。配列の並び（インデックス）がそのまま強さレベルになる（0 = 参加しない）。 */
export interface ColorDef {
  name: string;
  hex: string;
  /** 枠線の色（ヨコサワ表の「ピンク枠」など） */
  outline?: string;
}

export interface Settings {
  /** 色の強さの順番（弱い順）と表示色 */
  colorOrder: ColorDef[];
  /** 169ハンド → 色名。未入力はグレー（レベル0）扱い */
  handColors: Record<string, string>;
  /** ポジション → 参加基準色名。未入力は未設定扱い */
  positionBaseColors: Partial<Record<Position, string>>;
  /**
   * BBのディフェンス：レイザーの基準色から何段下までコールするか。
   * 「BBのみコールOK」の最下段（レベル1）は BTN・SB のレイズに対してだけ使う。
   */
  bbDefendSteps: number;
  /** リレイズ（3ベット）に必要な段数 */
  reraiseStep: number;
  /** 3ベットに対する4ベットに必要な段数（4ベットレンジ = R + reraiseStep + fourBetStep） */
  fourBetStep: number;
  /** 6人以下のとき、先頭（最初に行動する席）を「UTG」と表示する */
  labelFirstSeatAsUtg: boolean;
}

/** 初期値はヨコサワ表（リング／トーナメント）そのもの */
export function defaultSettings(format: Format = 'ring'): Settings {
  return yokosawaSettings(format);
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

const storageKey = (format: Format) => `poker-assist.settings.v2.${format}`;

export function loadSettings(format: Format): Settings {
  try {
    const raw = localStorage.getItem(storageKey(format));
    if (!raw) return defaultSettings(format);
    return parseSettings(JSON.parse(raw), format).settings;
  } catch {
    return defaultSettings(format);
  }
}

export function saveSettings(format: Format, s: Settings): void {
  try {
    localStorage.setItem(storageKey(format), JSON.stringify(s));
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
export function parseSettings(
  data: unknown,
  format: Format = 'ring',
): { settings: Settings; warnings: string[] } {
  const warnings: string[] = [];
  const base = defaultSettings(format);
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
      colorOrder = parsed.map((c) =>
        typeof c.outline === 'string' ? { name: c.name, hex: c.hex, outline: c.outline } : { name: c.name, hex: c.hex },
      );
    } else {
      warnings.push('colorOrder が不正なため初期値を使います');
    }
  }
  // handColors / positionBaseColors は読み込んだ値で置き換える（JSONにあれば）
  const s: Settings = {
    ...base,
    colorOrder,
    handColors: typeof d.handColors === 'object' && d.handColors !== null ? {} : base.handColors,
    positionBaseColors:
      typeof d.positionBaseColors === 'object' && d.positionBaseColors !== null ? {} : base.positionBaseColors,
  };
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
  for (const key of ['bbDefendSteps', 'reraiseStep', 'fourBetStep'] as const) {
    const v = d[key];
    if (v === undefined) continue;
    const min = key === 'bbDefendSteps' ? 0 : 1;
    if (typeof v === 'number' && Number.isInteger(v) && v >= min) s[key] = v;
    else warnings.push(`${key} は${min}以上の整数にしてください（初期値を使います）`);
  }
  if (typeof d.labelFirstSeatAsUtg === 'boolean') s.labelFirstSeatAsUtg = d.labelFirstSeatAsUtg;
  return { settings: s, warnings };
}
