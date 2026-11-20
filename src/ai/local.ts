import { z } from 'zod';
import type { Advice } from '../engine/advisor';
import type { GameState } from '../engine/state';
import type { Format } from '../logic/yokosawa';
import { COACH_SYSTEM, ScreenSchema, VISION_PROMPT, coachPrompt, finishRead, type ScreenRead, type ScreenResult } from './claude';

/**
 * PCの Claude CLI（Maxプラン等のログイン）で読み取る。
 * bridge/server.mjs が同じPCで動いているときだけ使える（アプリと同じ場所の /api/... を呼ぶ）。
 */
export const LOCAL_MODELS = [
  { id: 'haiku', label: 'Haiku（最速）' },
  { id: 'sonnet', label: 'Sonnet（標準）' },
  { id: 'opus', label: 'Opus（高精度・遅め）' },
] as const;
export type LocalModel = (typeof LOCAL_MODELS)[number]['id'];

export interface BridgeStatus {
  ok: boolean;
  version?: string;
}

export async function bridgeHealth(): Promise<BridgeStatus> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 1500);
    const res = await fetch('./api/health', { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false };
    const j = (await res.json()) as { ok?: boolean; version?: string };
    return { ok: j.ok === true, version: j.version };
  } catch {
    return { ok: false };
  }
}

const INSTRUCTIONS = `${VISION_PROMPT}

出力：次の JSON Schema に従う JSON オブジェクトを1つだけ出力してください（前後の説明文やコードブロックの記号は不要）。
${JSON.stringify(z.toJSONSchema(ScreenSchema))}`;

const DEFAULTS: ScreenRead = {
  is_poker_table: true,
  hand_in_progress: false,
  is_hero_turn: false,
  notes: '',
  format: 'unknown',
  hero_cards: [],
  board: [],
  center_pot: null,
  big_blind: null,
  seats: [],
};

/** 返ってきた文字列から JSON を取り出し、欠けた・おかしい項目は既定値にする */
export function parseScreenJson(text: string): ScreenRead {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('読み取り結果にJSONがありませんでした');
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(text.slice(a, b + 1));
  } catch {
    throw new Error('読み取り結果のJSONが壊れていました');
  }
  const whole = ScreenSchema.safeParse({ ...DEFAULTS, ...obj });
  if (whole.success) return whole.data;
  const out: Record<string, unknown> = { ...DEFAULTS };
  for (const [key, field] of Object.entries(ScreenSchema.shape)) {
    const r = (field as z.ZodType).safeParse(obj[key]);
    if (r.success) out[key] = r.data;
  }
  // 席の一部だけおかしいときは、その項目を既定値にして残す
  if (Array.isArray(obj.seats) && (out.seats as unknown[]).length === 0) {
    const seat = ScreenSchema.shape.seats.element;
    const seatDefault = { stack: null, d: false, badge: 'none', fold: false, bet: null, act: 'none' };
    out.seats = obj.seats.flatMap((x: unknown) => {
      if (typeof x !== 'object' || x === null) return [];
      const fixed: Record<string, unknown> = { ...seatDefault };
      for (const [k, f] of Object.entries(seat.shape)) {
        const r = (f as z.ZodType).safeParse((x as Record<string, unknown>)[k]);
        if (r.success) fixed[k] = r.data;
      }
      return [fixed];
    });
  }
  return out as ScreenRead;
}

async function postJson(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error('PCのClaude（中継プログラム）に接続できません。start-poker-assist.bat で起動してください');
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? `中継プログラムのエラー（${res.status}）`);
  }
  return res;
}

/** claude を先に起動しておく（最初の読み取りを速くする）。失敗しても気にしない */
export function warmBridge(model: LocalModel): void {
  void postJson('./api/warm', { model, instructions: INSTRUCTIONS }).catch(() => {});
}

export async function readViaBridge(
  image: { base64: string; mediaType: string },
  fallbackFormat: Format,
  model: LocalModel,
  signal?: AbortSignal,
): Promise<ScreenResult> {
  const res = await postJson('./api/read', { model, instructions: INSTRUCTIONS, image }, signal);
  const j = (await res.json()) as { text: string };
  return finishRead(parseScreenJson(j.text), fallbackFormat);
}

export async function coachViaBridge(
  state: GameState,
  advice: Advice,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await postJson('./api/coach', { prompt: `${COACH_SYSTEM}\n\n${coachPrompt(state, advice)}` }, signal);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onText(dec.decode(value, { stream: true }));
  }
}
