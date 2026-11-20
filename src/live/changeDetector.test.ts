import { describe, expect, it } from 'vitest';
import { ChangeDetector, diffRatio } from './changeDetector';

const frame = (fill: number, patch?: { from: number; to: number; v: number }) => {
  const a = new Uint8Array(1000).fill(fill);
  if (patch) a.fill(patch.v, patch.from, patch.to);
  return a;
};

describe('ChangeDetector', () => {
  it('diffRatio', () => {
    expect(diffRatio(frame(0), frame(0), 10)).toBe(0);
    expect(diffRatio(frame(0), frame(0, { from: 0, to: 100, v: 200 }), 10)).toBeCloseTo(0.1);
  });
  it('最初の画面は止まってから1回だけ送る', () => {
    const d = new ChangeDetector({ ...d0(), minIntervalMs: 0 });
    expect(d.push(frame(50), 0)).toBe(false); // まだ止まっているか分からない
    expect(d.push(frame(50), 500)).toBe(false);
    expect(d.push(frame(50), 1000)).toBe(true);
    d.markSent(frame(50), 1000);
    expect(d.push(frame(50), 1500)).toBe(false); // 変化なし
  });
  it('小さな動き（タイマー）は無視、大きな変化は止まってから送る', () => {
    const d = new ChangeDetector({ ...d0(), minIntervalMs: 0 });
    d.markSent(frame(50), 0);
    expect(d.push(frame(50, { from: 0, to: 5, v: 255 }), 100)).toBe(false); // 0.5%
    expect(d.push(frame(50, { from: 0, to: 5, v: 0 }), 200)).toBe(false);
    const dealt = frame(50, { from: 300, to: 400, v: 255 }); // 10%
    expect(d.push(dealt, 300)).toBe(false); // 動いた直後
    expect(d.push(dealt, 400)).toBe(false);
    expect(d.push(dealt, 500)).toBe(true);
  });
  it('最小間隔', () => {
    const d = new ChangeDetector({ ...d0(), minIntervalMs: 3000 });
    d.markSent(frame(0), 0);
    const f = frame(200);
    d.push(f, 100);
    d.push(f, 200);
    expect(d.push(f, 300)).toBe(false);
    expect(d.push(f, 3100)).toBe(true);
  });
});

function d0() {
  return { pixelThreshold: 28, changeRatio: 0.012, stableRatio: 0.004, stableFrames: 2, minIntervalMs: 0 };
}
