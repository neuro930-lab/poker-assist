import { useEffect, useRef, type ReactNode } from 'react';
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
  /** 表計算ソフトのように行・列の見出し（A〜2）を付け、選択中のハンドの行と列を強調する */
  headers?: boolean;
}

/** 背景色に対して読みやすい文字色 */
export function textColorFor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return '#111';
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}

export function HandGrid({ settings, selected, highlight, onCellDown, onCellDrag, headers }: Props) {
  const dragging = useRef(false);

  useEffect(() => {
    const up = () => (dragging.current = false);
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);

  let selR = -1;
  let selC = -1;
  if (selected) {
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) if (handAt(r, c) === selected) [selR, selC] = [r, c];
  }

  const cells = RANKS.map((rank, r) => (
    <Row key={rank}>
      {headers && <span className={`grid-head${r === selR ? ' hl' : ''}`}>{rank}</span>}
      {RANKS.map((__, c) => {
        const hand = handAt(r, c);
        const color = colorAt(settings, handLevel(settings, hand));
        const inRange = highlight?.has(hand);
        const cls = ['cell'];
        if (hand === selected) cls.push('selected');
        else if (headers && (r === selR || c === selC)) cls.push('cross');
        if (highlight) cls.push(inRange ? 'in-range' : 'out-range');
        return (
          <button
            key={hand}
            type="button"
            className={cls.join(' ')}
            style={{
              background: color.hex,
              color: textColorFor(color.hex),
              ...(color.outline ? { borderColor: color.outline, borderWidth: 3 } : {}),
            }}
            title={`${hand}：${color.name}`}
            aria-current={hand === selected ? 'true' : undefined}
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
      })}
    </Row>
  ));

  return (
    <div className={`hand-grid${headers ? ' with-headers' : ''}`} onMouseLeave={() => (dragging.current = false)}>
      {headers && (
        <>
          <span className="grid-head corner" />
          {RANKS.map((rank, c) => (
            <span key={rank} className={`grid-head${c === selC ? ' hl' : ''}`}>{rank}</span>
          ))}
        </>
      )}
      {cells}
    </div>
  );
}

/** グリッドの1行（display: contents で親グリッドに並べる） */
function Row({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
