import { useEffect, useRef } from 'react';
import { RANKS, handAt } from '../logic/hands';
import { colorAt, handLevel, type Settings } from '../logic/settings';

interface Props {
  settings: Settings;
  selected?: string | null;
  /** 相手の想定レンジ（指定時は範囲外のマスを薄くする） */
  highlight?: Set<string>;
  onCellDown?: (hand: string) => void;
  /** ドラッグ中に通過したマス（設定画面の塗りつぶし用） */
  onCellDrag?: (hand: string) => void;
}

/** 背景色に対して読みやすい文字色 */
export function textColorFor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#111';
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}

export function HandGrid({ settings, selected, highlight, onCellDown, onCellDrag }: Props) {
  const dragging = useRef(false);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  return (
    <div className="hand-grid" onMouseLeave={() => (dragging.current = false)}>
      {RANKS.map((_, r) =>
        RANKS.map((__, c) => {
          const hand = handAt(r, c);
          const color = colorAt(settings, handLevel(settings, hand));
          const inRange = highlight?.has(hand);
          const cls = ['cell'];
          if (hand === selected) cls.push('selected');
          if (highlight) cls.push(inRange ? 'in-range' : 'out-range');
          return (
            <button
              key={hand}
              type="button"
              className={cls.join(' ')}
              style={{ background: color.hex, color: textColorFor(color.hex) }}
              title={`${hand}：${color.name}`}
              onMouseDown={(e) => {
                if (e.button !== 0) return;
                dragging.current = true;
                onCellDown?.(hand);
              }}
              onMouseEnter={() => dragging.current && onCellDrag?.(hand)}
            >
              {hand}
            </button>
          );
        }),
      )}
    </div>
  );
}
