/**
 * 画面の変化を検知して「今、AIに読ませるべきか」を決める。
 * 縮小したグレースケール画像を一定間隔で渡す。
 *  - 前回AIに送った画面から十分変わった（カードが配られた・誰かが行動した 等）
 *  - かつ、直近の数フレームは止まっている（アニメーション中に送らない）
 *  - かつ、前回の送信から最小間隔が経っている
 * のときに true を返す。ターンのタイマーのような小さな動きは無視できるよう、
 * 「変化したピクセルの割合」で判定する。
 */
export interface DetectorOptions {
  /** 1ピクセルを「変化した」とみなす明るさの差（0〜255） */
  pixelThreshold: number;
  /** 前回送信からこの割合以上のピクセルが変わったら「変化あり」 */
  changeRatio: number;
  /** 直前フレームとの差がこの割合未満なら「止まっている」 */
  stableRatio: number;
  /** 何フレーム続けて止まっていたら送るか */
  stableFrames: number;
  /** 送信の最小間隔（ミリ秒） */
  minIntervalMs: number;
}

export const DEFAULT_DETECTOR: DetectorOptions = {
  pixelThreshold: 28,
  changeRatio: 0.012,
  stableRatio: 0.004,
  stableFrames: 2,
  minIntervalMs: 2500,
};

export function diffRatio(a: Uint8Array, b: Uint8Array, pixelThreshold: number): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > pixelThreshold) n++;
  return n / a.length;
}

export class ChangeDetector {
  private prev: Uint8Array | null = null;
  private sent: Uint8Array | null = null;
  private stableCount = 0;
  private lastSentAt = -Infinity;
  /** 直近の値（画面表示用） */
  lastChange = 0;
  lastMotion = 0;

  constructor(public opts: DetectorOptions = DEFAULT_DETECTOR) {}

  /** 新しいフレームを渡す。AIに送るべきなら true（呼び出し側は送ったら markSent を呼ぶ） */
  push(gray: Uint8Array, now: number): boolean {
    const o = this.opts;
    this.lastMotion = this.prev ? diffRatio(gray, this.prev, o.pixelThreshold) : 1;
    this.prev = gray;
    this.stableCount = this.lastMotion < o.stableRatio ? this.stableCount + 1 : 0;
    this.lastChange = this.sent ? diffRatio(gray, this.sent, o.pixelThreshold) : 1;
    return this.lastChange >= o.changeRatio && this.stableCount >= o.stableFrames && now - this.lastSentAt >= o.minIntervalMs;
  }

  markSent(gray: Uint8Array, now: number): void {
    this.sent = gray;
    this.lastSentAt = now;
  }

  /** 手動解析や設定変更のあと、次の変化から数え直す */
  reset(): void {
    this.sent = null;
    this.stableCount = 0;
    this.lastSentAt = -Infinity;
  }
}
