import { STREET_LABELS, type Advice } from '../engine/advisor';

export function AdvicePanel({ advice }: { advice: Advice }) {
  const a = advice;
  return (
    <section className="panel advice" aria-live="polite">
      <h2>② 最適なプレー <small>{STREET_LABELS[a.street]}</small></h2>
      {a.status === 'incomplete' ? (
        <>
          <div className="action action-wait">入力待ち</div>
          <p className="reason">足りない情報：{a.missing.join('、')}</p>
        </>
      ) : (
        <>
          <div className={`action action-${a.action}`}>▶ {a.headline}</div>
          {a.sizing && <p className="sizing">サイズ：{a.sizing}</p>}
          <h3>なぜ？</h3>
          <ol className="reasons">
            {a.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
          <dl className="numbers">
            {a.numbers.map((n) => (
              <div key={n.label}>
                <dt>{n.label}</dt>
                <dd>{n.value}</dd>
              </div>
            ))}
          </dl>
          {a.notes.length > 0 && (
            <>
              <h3>補足</h3>
              <ul className="notes">
                {a.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </>
          )}
          {a.villainRanges.length > 0 && (
            <>
              <h3>相手のレンジ（推定）</h3>
              <ul className="notes">
                {a.villainRanges.map((r) => (
                  <li key={r.position + r.label}>
                    {r.label}：全体の約{r.percent.toFixed(0)}%
                  </li>
                ))}
              </ul>
              {a.street !== 'preflop' && (
                <p className="hint">ボードと相手のアクション（ベット・チェック）に合わせて、強さ順に重みを付け直して勝率を計算しています。</p>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
