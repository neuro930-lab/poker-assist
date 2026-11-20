import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { Format } from '../logic/yokosawa';
import type { Advice } from '../engine/advisor';
import type { GameState } from '../engine/state';
import { ScreenSchema, VISION_PROMPT, screenToState, type ScreenRead } from './screen';

export const MODEL = 'claude-opus-5-5';

/** 画面読み取りに使うモデル（設定で選べる）。精度は Opus、速さは Sonnet / Haiku */
export const VISION_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5（高精度・標準）' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5（速い）' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5（最速・低コスト）' },
] as const;
export type VisionModel = (typeof VISION_MODELS)[number]['id'];

/**
 * APIキーはこのブラウザの localStorage にだけ保存し、api.anthropic.com に直接送る。
 * 自分専用のローカルツールとして使う前提（公開サーバーに置く場合はバックエンド経由にすること）。
 */
function client(apiKey: string) {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export { ScreenSchema, VISION_PROMPT, type ScreenRead } from './screen';

export interface ScreenResult {
  state: Partial<GameState>;
  warnings: string[];
  notes: string;
  /** 手札が見えていてハンドの途中か（false のときは局面を上書きしない） */
  handInProgress: boolean;
  isHeroTurn: boolean;
  raw: ScreenRead;
}

export async function readScreenshot(
  apiKey: string,
  image: { base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' },
  fallbackFormat: Format,
  opts: { model?: VisionModel; signal?: AbortSignal } = {},
): Promise<ScreenResult> {
  const model = opts.model ?? MODEL;
  // Haiku 5.5 はサーバー側フォールバック非対応
  const fallback = model === 'claude-haiku-5-5' ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const };
  const res = await client(apiKey).beta.messages.parse(
    {
      model,
      max_tokens: 16000,
      ...fallback,
      // リアルタイムで使うので、考える量は少なめ（読み取りは推論より視覚が中心）
      output_config: { effort: 'low', format: betaZodOutputFormat(ScreenSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
            { type: 'text', text: VISION_PROMPT },
          ],
        },
      ],
    },
    { signal: opts.signal },
  );
  if (res.stop_reason === 'refusal') throw new Error('この画像は解析できませんでした（リクエストが拒否されました）');
  const parsed = res.parsed_output;
  if (!parsed) throw new Error('解析結果を読み取れませんでした。もう一度試してください');
  return finishRead(parsed, fallbackFormat);
}

/** 読み取り結果（APIでもPCのClaudeでも共通）→ アプリの局面 */
export function finishRead(parsed: ScreenRead, fallbackFormat: Format): ScreenResult {
  if (!parsed.is_poker_table) throw new Error(`ポーカーの画面として認識できませんでした${parsed.notes ? `：${parsed.notes}` : ''}`);
  const { state, warnings } = screenToState(parsed, fallbackFormat);
  return {
    state,
    warnings,
    notes: parsed.notes,
    handInProgress: parsed.hand_in_progress && (state.heroCards?.length ?? 0) === 2,
    isHeroTurn: parsed.is_hero_turn,
    raw: parsed,
  };
}

export const COACH_SYSTEM = `あなたは世界トップクラスのポーカーコーチです（GTOと実戦的なエクスプロイトの両方に精通）。
ユーザーはヨコサワ式ハンドレンジ表で学習中の日本語話者です。
与えられた局面と、ローカルの計算エンジンの結果（推定レンジ相手のエクイティ、ポットオッズ、推奨アクション）を検討し、
最善のプレーを判断してください。エンジンと意見が違う場合は、はっきりそう書いて理由を示してください。

出力形式（日本語・簡潔に、見出しは「■」）：
■ 結論：アクションとサイズを1行で
■ 理由：3〜5個の箇条書き（レンジ、ブロッカー、ポジション、SPR、ボードとレンジの相性など）
■ 相手のタイプ別の調整：タイト／ルース／コーリングステーションなど
■ 次のストリートの計画：どのカードで何をするか
■ 覚えておくポイント：一般化できる教訓を1つ`;

/** AIコーチに渡す局面の説明（APIでもPCのClaudeでも共通） */
export function coachPrompt(state: GameState, advice: Advice): string {
  const summary = {
    format: state.format === 'ring' ? 'リングゲーム' : 'トーナメント',
    players: state.players,
    hero: { position: state.heroPosition, cards: state.heroCards, stack: state.heroStack },
    board: state.board,
    bigBlind: state.bigBlind,
    pot: state.pot,
    toCall: state.toCall,
    preflop: state.preflop,
    heroIsPreflopAggressor: state.heroIsAggressor,
    opponents: state.opponents,
    villainActionThisStreet: state.villainAction,
    engine: {
      recommendation: advice.headline,
      sizing: advice.sizing,
      reasons: advice.reasons,
      numbers: advice.numbers,
      villainRanges: advice.villainRanges,
      yokosawa: advice.yokosawa && {
        hand: advice.yokosawa.hand,
        color: advice.yokosawa.colorName,
        meaning: advice.yokosawa.meaning,
        positionColor: advice.yokosawa.positionColor,
      },
    },
  };
  return `局面（JSON）：\n${JSON.stringify(summary, null, 2)}`;
}

export async function coach(
  apiKey: string,
  state: GameState,
  advice: Advice,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const stream = client(apiKey).beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high' },
      system: COACH_SYSTEM,
      messages: [{ role: 'user', content: coachPrompt(state, advice) }],
    },
    { signal },
  );
  stream.on('text', (t) => onText(t));
  const final = await stream.finalMessage();
  if (final.stop_reason === 'refusal') onText('\n\n（この内容には回答できませんでした）');
}

export function explainApiError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'APIキーが正しくありません（設定タブで確認してください）';
  if (e instanceof Anthropic.PermissionDeniedError) return 'このAPIキーではモデルを使えません';
  if (e instanceof Anthropic.RateLimitError) return '利用上限に達しました。少し待ってから再試行してください';
  if (e instanceof Anthropic.BadRequestError) return `リクエストエラー：${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return '接続できませんでした（ネットワークを確認してください）';
  if (e instanceof Anthropic.APIError) return `APIエラー（${e.status}）：${e.message}`;
  if (e instanceof Error) return e.name === 'AbortError' ? '中止しました' : e.message;
  return String(e);
}

const MODEL_STORAGE = 'poker-assist.vision-model';
export function loadVisionModel(): VisionModel {
  try {
    const v = localStorage.getItem(MODEL_STORAGE);
    return VISION_MODELS.some((m) => m.id === v) ? (v as VisionModel) : MODEL;
  } catch {
    return MODEL;
  }
}
export function saveVisionModel(m: VisionModel): void {
  try {
    localStorage.setItem(MODEL_STORAGE, m);
  } catch {
    // 保存できなくてもその場では使える
  }
}

const KEY_STORAGE = 'poker-assist.anthropic-key';
export function loadApiKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}
export function saveApiKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // 保存できない環境では、その場限りで使う
  }
}
