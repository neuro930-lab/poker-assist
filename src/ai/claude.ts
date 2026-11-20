import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { ALL_POSITIONS, type Position } from '../logic/positions';
import type { Format } from '../logic/yokosawa';
import { parseCard, cardToString } from '../engine/cards';
import type { Advice } from '../engine/advisor';
import type { GameState, Opponent } from '../engine/state';

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

const POS = z.enum([...ALL_POSITIONS, 'unknown']);

const ScreenSchema = z.object({
  is_poker_table: z.boolean().describe('ポーカーのテーブル画面か'),
  hand_in_progress: z.boolean().describe('自分の手札2枚が表向きで見えていて、ハンドの途中か'),
  is_hero_turn: z.boolean().describe('今まさに自分のアクション番か（コール／レイズ等のボタンが出ている）'),
  notes: z.string().describe('読み取りの補足・自信がない点（日本語・短く）'),
  format: z.enum(['ring', 'tournament', 'unknown']),
  players: z.number().int().describe('卓に座っているプレイヤー数（空席は除く、2〜9）'),
  hero_position: POS,
  hero_cards: z.array(z.string()).describe('自分の手札。"As" "Td" の形式（ランク23456789TJQKA＋スートshdc）'),
  board: z.array(z.string()).describe('コミュニティカード。同じ形式'),
  big_blind: z.number().nullable().describe('ビッグブラインドの額（金額がBB表示なら1）'),
  pot: z.number().nullable().describe('現在のポット合計（このストリートで出ているベットも含む）'),
  to_call: z.number().nullable().describe('自分がコールするのに必要な額。チェックできるなら0'),
  hero_stack: z.number().nullable().describe('自分の残りスタック'),
  preflop: z.enum(['unopened', 'limped', 'raised', '3bet', '4bet', 'unknown']),
  hero_is_aggressor: z.boolean().describe('プリフロップで最後にレイズしたのが自分か'),
  opponents: z
    .array(
      z.object({
        position: POS,
        stack: z.number().nullable(),
        role: z.enum(['unknown', 'opener', 'caller', '3bettor', '4bettor', 'limper', 'blind']),
      }),
    )
    .describe('このストリートまでに自分からチップを入れて参加した相手のみ（FOLD表示の人、まだ一度も行動していない人は除く）'),
  villain_action: z.enum(['none', 'check', 'bet', 'raise']).describe('今のストリートで相手がした一番強いアクション'),
  villain_bets_earlier: z.number().int().describe('前のストリートで相手がベット・レイズした回数（分かる範囲）'),
});
export type ScreenRead = z.infer<typeof ScreenSchema>;

const VISION_PROMPT = `これはテキサスホールデム（スマホアプリ）のゲーム画面です。縦長の画面で、PCにミラーリングしたものをキャプチャしている場合があります（ウィンドウの枠や余白は無視）。今の局面を正確に読み取ってください。

画面の見方：
- 画面いちばん下に大きく表示されている2枚のカードが「自分」の手札。自分の席はその近く（下側）のアイコン。
- 各プレイヤーはアイコン＋名前＋その下の数字（＝残りスタック）。アイコンに「FOLD」と出ている人はフォールド済み。
- アイコンの左上にある小さな「D」マーク（オレンジ等）がディーラーボタン。「SB」「BB」バッジが付いている人がブラインド。
- テーブル中央の「POT」の数字に加えて、各プレイヤーの前に置かれたチップの数字（楕円の枠に入った数字）が、このストリートのベット額。
- カードは "As"（スペードのA）、"Td"（ダイヤの10）の形式。s=♠ h=♥ d=♦ c=♣。

ポジションの決め方：
- 席は時計回りに並んでいる。D の次の席が SB、その次が BB（SB/BB バッジがあればそれを優先）。
- 6人なら D から時計回りに BTN, SB, BB, LJ, HJ, CO。人数が少ないときは UTG 側（BBの次）から消える。空席は数えない。

金額：
- big_blind：画面に表示がなければ、BBバッジの人の前のベット額（プリフロップでまだ誰もレイズしていない段階）または SB のベット額の2倍から推定。どうしても分からなければ null。
- pot：中央の POT の数字＋全員の前に出ているベット額の合計（＝今コールした場合を除く、テーブル上の総額）。
- to_call：一番大きいベット額 − 自分の前に出ているベット額。自分の番でなくても、この時点の値を入れる。
- 1/6位・Lv.1 などの表示や「順位」があればトーナメント。

その他：
- opponents には、自分からチップを入れて参加した相手（レイズ・コール・ベットした人。リンプ含む）だけを入れる。まだ行動していない人・FOLDの人は入れない。
- preflop：自分より前に誰かがレイズしていれば raised（そのレイザーの role は opener）。
- 手札が見えない（ハンドとハンドの間など）は hand_in_progress=false、hero_cards は空。
- 見えない・自信のない情報は notes に短く書く。カードを推測で埋めない。`;

function toState(r: ScreenRead, fallbackFormat: Format): { state: Partial<GameState>; warnings: string[] } {
  const warnings: string[] = [];
  const cards = (xs: string[], what: string) => {
    const out: string[] = [];
    for (const x of xs) {
      const c = parseCard(x);
      if (c === null) warnings.push(`${what}「${x}」を読めませんでした`);
      else out.push(cardToString(c));
    }
    return out;
  };
  const pos = (p: string): Position | null => ((ALL_POSITIONS as readonly string[]).includes(p) ? (p as Position) : null);
  const opponents: Opponent[] = [];
  for (const o of r.opponents) {
    const p = pos(o.position);
    if (p) opponents.push({ position: p, stack: o.stack, role: o.role });
    else warnings.push('ポジション不明の相手がいます（手入力で直してください）');
  }
  const state: Partial<GameState> = {
    format: r.format === 'unknown' ? fallbackFormat : r.format,
    players: Math.max(2, Math.min(9, r.players || 6)),
    heroPosition: pos(r.hero_position),
    heroCards: cards(r.hero_cards, '手札'),
    board: cards(r.board, 'ボード'),
    bigBlind: r.big_blind && r.big_blind > 0 ? r.big_blind : 1,
    pot: r.pot ?? 0,
    toCall: r.to_call ?? 0,
    heroStack: r.hero_stack ?? 100,
    preflop: r.preflop === 'unknown' ? 'raised' : r.preflop,
    heroIsAggressor: r.hero_is_aggressor,
    opponents,
    villainAction: r.villain_action,
    villainBetsEarlier: Math.max(0, r.villain_bets_earlier),
  };
  if (r.big_blind === null) warnings.push('BB額が読めなかったので1（BB単位）として扱います');
  if (!state.heroPosition) warnings.push('自分のポジションが読めませんでした');
  return { state, warnings };
}

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
  if (!parsed.is_poker_table) throw new Error(`ポーカーの画面として認識できませんでした：${parsed.notes}`);
  const { state, warnings } = toState(parsed, fallbackFormat);
  return {
    state,
    warnings,
    notes: parsed.notes,
    handInProgress: parsed.hand_in_progress && (state.heroCards?.length ?? 0) === 2,
    isHeroTurn: parsed.is_hero_turn,
    raw: parsed,
  };
}

const COACH_SYSTEM = `あなたは世界トップクラスのポーカーコーチです（GTOと実戦的なエクスプロイトの両方に精通）。
ユーザーはヨコサワ式ハンドレンジ表で学習中の日本語話者です。
与えられた局面と、ローカルの計算エンジンの結果（推定レンジ相手のエクイティ、ポットオッズ、推奨アクション）を検討し、
最善のプレーを判断してください。エンジンと意見が違う場合は、はっきりそう書いて理由を示してください。

出力形式（日本語・簡潔に、見出しは「■」）：
■ 結論：アクションとサイズを1行で
■ 理由：3〜5個の箇条書き（レンジ、ブロッカー、ポジション、SPR、ボードとレンジの相性など）
■ 相手のタイプ別の調整：タイト／ルース／コーリングステーションなど
■ 次のストリートの計画：どのカードで何をするか
■ 覚えておくポイント：一般化できる教訓を1つ`;

export async function coach(
  apiKey: string,
  state: GameState,
  advice: Advice,
  onText: (delta: string) => void,
  signal?: AbortSignal,
): Promise<void> {
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
  const stream = client(apiKey).beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high' },
      system: COACH_SYSTEM,
      messages: [{ role: 'user', content: `局面（JSON）：\n${JSON.stringify(summary, null, 2)}` }],
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
