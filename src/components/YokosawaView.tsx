import { HandGrid, textColorFor } from './HandGrid';
import type { Advice } from '../engine/advisor';
import type { Settings } from '../logic/settings';
import { FORMAT_LABELS, tierMeanings, type Format } from '../logic/yokosawa';

interface Props {
  format: Format;
  settings: Settings;
  advice: Advice;
  showRange: boolean;
  onToggleRange: (v: boolean) => void;
}

export function YokosawaView({ format, settings, advice, showRange, onToggleRange }: Props) {
  const y = advice.yokosawa;
  const meanings = tierMeanings(format);
  const highlight = showRange && advice.highlightHands.length > 0 ? new Set(advice.highlightHands) : undefined;
  return (
    <section className="panel yokosawa">
      <h2>
        ③ ヨコサワ表での位置 <small>{FORMAT_LABELS[format]}</small>
        <a className="small-btn" href="./yokosawa-ranges.xlsx" download>
          Excel版をダウンロード
        </a>
      </h2>
      {y ? (
        <p className="y-summary">
          <span className="hand-name">{y.hand}</span> は
          <ColorSwatch settings={settings} name={y.colorName} />
          {y.meaning && <>＝{y.meaning}</>}
          {y.positionColor && (
            <>
              ／あなたのポジションの基準は
              <ColorSwatch settings={settings} name={y.positionColor} />
              {y.level >= settings.colorOrder.findIndex((c) => c.name === y.positionColor) ? (
                <b className="ok">→ 参加できる</b>
              ) : (
                <b className="ng">→ 基準に届かない</b>
              )}
            </>
          )}
        </p>
      ) : (
        <p className="hint">手札を入力すると、表の中の位置が青枠で表示されます。</p>
      )}
      <HandGrid settings={settings} selected={y?.hand ?? null} highlight={highlight} headers />
      <div className="legend">
        <span className="lg-me">青枠＝自分の手札</span>
        <label className="lg-range">
          <input type="checkbox" checked={showRange} onChange={(e) => onToggleRange(e.target.checked)} /> 橙枠＝相手の推定レンジ
        </label>
      </div>
      <ul className="tier-legend">
        {settings.colorOrder.map((c, i) => (
          <li key={c.name} className={y && y.colorName === c.name ? 'current' : ''}>
            <ColorSwatch settings={settings} name={c.name} />
            <span>{meanings[i]?.name === c.name ? meanings[i].meaning : ''}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ColorSwatch({ settings, name }: { settings: Settings; name: string }) {
  const c = settings.colorOrder.find((x) => x.name === name);
  if (!c) return <span className="swatch">{name}</span>;
  return (
    <span
      className="swatch"
      style={{ background: c.hex, color: textColorFor(c.hex), ...(c.outline ? { borderColor: c.outline, borderWidth: 2 } : {}) }}
    >
      {c.name}
    </span>
  );
}
