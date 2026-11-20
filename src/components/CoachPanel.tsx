import { useEffect, useRef, useState } from 'react';
import { coach, explainApiError } from '../ai/claude';
import type { Advice } from '../engine/advisor';
import type { GameState } from '../engine/state';

interface Props {
  apiKey: string;
  state: GameState;
  advice: Advice;
  onNeedKey: () => void;
}

export function CoachPanel({ apiKey, state, advice, onNeedKey }: Props) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const key = JSON.stringify(state);

  // 局面が変わったら古い解説は消す
  useEffect(() => {
    abortRef.current?.abort();
    setText('');
    setError('');
  }, [key]);

  const run = async () => {
    if (!apiKey) {
      onNeedKey();
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setText('');
    setError('');
    try {
      await coach(apiKey, state, advice, (t) => setText((x) => x + t), ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) setError(explainApiError(e));
    } finally {
      if (abortRef.current === ac) setBusy(false);
    }
  };

  return (
    <section className="panel coach">
      <h2>④ AIコーチの解説</h2>
      <p className="hint">計算エンジンの結果をもとに、レンジ・ブロッカー・相手のタイプ別の調整・次のストリートの計画まで解説します。</p>
      <div className="row">
        <button type="button" className="primary" disabled={advice.status !== 'ok' || busy} onClick={() => void run()}>
          {busy ? '考え中…' : text ? 'もう一度聞く' : 'AIコーチに詳しく聞く'}
        </button>
        {busy && (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            中止
          </button>
        )}
      </div>
      {error && <p className="warning">⚠ {error}</p>}
      {text && <div className="coach-text">{text}</div>}
    </section>
  );
}
