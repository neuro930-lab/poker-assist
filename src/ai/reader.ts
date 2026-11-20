import type { Advice } from '../engine/advisor';
import type { GameState } from '../engine/state';
import type { Format } from '../logic/yokosawa';
import { coach, readScreenshot, type ScreenResult, type VisionModel } from './claude';
import { coachViaBridge, readViaBridge, type LocalModel } from './local';

/** 画面の読み取り・AIコーチをどこで動かすか */
export type ReadMode = 'local' | 'api';

export interface Reader {
  mode: ReadMode;
  apiKey: string;
  apiModel: VisionModel;
  localModel: LocalModel;
  /** 中継プログラム（PCのClaude）につながっているか */
  bridgeOk: boolean;
}

export function readerReady(r: Reader): boolean {
  return r.mode === 'local' ? r.bridgeOk : r.apiKey !== '';
}

export function readerNotReadyMessage(r: Reader): string {
  return r.mode === 'local'
    ? 'PCのClaudeを使うには、start-poker-assist.bat から起動したアプリで開いてください'
    : '読み取りには Anthropic APIキーが必要です（設定タブ）';
}

export function readScreen(
  r: Reader,
  image: { base64: string; mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' },
  format: Format,
  signal?: AbortSignal,
): Promise<ScreenResult> {
  return r.mode === 'local'
    ? readViaBridge(image, format, r.localModel, signal)
    : readScreenshot(r.apiKey, image, format, { model: r.apiModel, signal });
}

export function coachWith(
  r: Reader,
  state: GameState,
  advice: Advice,
  onText: (t: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  return r.mode === 'local' ? coachViaBridge(state, advice, onText, signal) : coach(r.apiKey, state, advice, onText, signal);
}

const MODE_KEY = 'poker-assist.read-mode';
const LOCAL_MODEL_KEY = 'poker-assist.local-model';
export function loadReadMode(): ReadMode | null {
  try {
    const v = localStorage.getItem(MODE_KEY);
    return v === 'local' || v === 'api' ? v : null;
  } catch {
    return null;
  }
}
export function saveReadMode(m: ReadMode): void {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    // 保存できなくても動く
  }
}
export function loadLocalModel(): LocalModel {
  try {
    const v = localStorage.getItem(LOCAL_MODEL_KEY);
    return v === 'haiku' || v === 'sonnet' || v === 'opus' ? v : 'sonnet';
  } catch {
    return 'sonnet';
  }
}
export function saveLocalModel(m: LocalModel): void {
  try {
    localStorage.setItem(LOCAL_MODEL_KEY, m);
  } catch {
    // 保存できなくても動く
  }
}
