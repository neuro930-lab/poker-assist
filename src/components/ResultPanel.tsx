import { ACTION_LABELS, type Decision } from '../logic/decide';
import { colorAt, type Settings } from '../logic/settings';
import { textColorFor } from './HandGrid';

interface Props {
  decision: Decision;
  settings: Settings;
}

export function ResultPanel({ decision: d, settings }: Props) {
  const range = d.opponentRange;
  return (
    <section className="result" aria-live="polite">
      {d.status === 'action' && d.action && (
        <div className={`action action-${d.action}`}>▶ {ACTION_LABELS[d.action]}</div>
      )}
      {d.status === 'rangeOnly' && <div className="action action-range">相手のレンジ</div>}
      {d.status === 'incomplete' && <div className="action action-wait">入力待ち</div>}
      <p className="reason">{d.status === 'incomplete' ? d.reason : `理由：${d.reason}`}</p>
      {d.notes.map((n) => (
        <p key={n} className="note">{n}</p>
      ))}
      {range && (
        <p className="range">
          {range.label}：
          <span
            className="swatch"
            style={{
              background: colorAt(settings, range.minLevel).hex,
              color: textColorFor(colorAt(settings, range.minLevel).hex),
            }}
          >
            {range.text}
          </span>
          （全組み合わせの約{range.percent.toFixed(1)}%、{range.combos}/1326通り）
        </p>
      )}
      {d.warnings.map((w) => (
        <p key={w} className="warning">⚠ {w}</p>
      ))}
    </section>
  );
}
