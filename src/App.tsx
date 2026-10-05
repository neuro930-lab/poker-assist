import { useCallback, useEffect, useMemo, useState } from 'react';
import { HandGrid } from './components/HandGrid';
import { ResultPanel } from './components/ResultPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { TableView } from './components/TableView';
import { decide, isSelectableOpponent, type Situation } from './logic/decide';
import { MAX_PLAYERS, MIN_PLAYERS, nextButton } from './logic/positions';
import { loadSettings, saveSettings, type Settings } from './logic/settings';

const PLAYERS_KEY = 'poker-assist.players.v1';

function loadPlayers(): number {
  try {
    const v = Number(localStorage.getItem(PLAYERS_KEY));
    if (Number.isInteger(v) && v >= MIN_PLAYERS && v <= MAX_PLAYERS) return v;
  } catch {
    // 読めなければ初期値
  }
  return MAX_PLAYERS;
}

const SITUATIONS: { id: Situation; label: string }[] = [
  { id: 'normal', label: '通常' },
  { id: 'vs3bet', label: 'vs3ベット' },
  { id: 'vs4bet', label: 'vs4ベット' },
];

export default function App() {
  const [tab, setTab] = useState<'main' | 'settings'>('main');
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [players, setPlayers] = useState(loadPlayers);
  const [btnSeat, setBtnSeat] = useState(0);
  const [mySeat, setMySeat] = useState<number | null>(null);
  const [hand, setHand] = useState<string | null>(null);
  const [opponentSeat, setOpponentSeat] = useState<number | null>(null);
  const [situation, setSituation] = useState<Situation>('normal');

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => {
    try {
      localStorage.setItem(PLAYERS_KEY, String(players));
    } catch {
      // 保存できなくても動作は続ける
    }
  }, [players]);

  const selectable = useCallback(
    (seat: number) => isSelectableOpponent(seat, mySeat, btnSeat, players, situation),
    [mySeat, btnSeat, players, situation],
  );

  // 席・状況が変わって相手指定が成り立たなくなったら解除する
  useEffect(() => {
    if (opponentSeat !== null && !selectable(opponentSeat)) setOpponentSeat(null);
  }, [opponentSeat, selectable]);

  const decision = useMemo(
    () => decide({ players, btnSeat, mySeat, hand, opponentSeat, situation, settings }),
    [players, btnSeat, mySeat, hand, opponentSeat, situation, settings],
  );
  const highlight = useMemo(
    () => (decision.opponentRange ? new Set(decision.opponentRange.hands) : undefined),
    [decision],
  );

  const resetHand = useCallback(() => {
    setHand(null);
    setOpponentSeat(null);
    setSituation('normal');
  }, []);

  const nextHand = useCallback(() => {
    setBtnSeat((b) => nextButton(b, players));
    resetHand();
  }, [players, resetHand]);

  const changePlayers = (n: number) => {
    setPlayers(n);
    setBtnSeat((b) => (b < n ? b : 0));
    setMySeat((s) => (s !== null && s < n ? s : null));
    setOpponentSeat(null);
  };

  const onSeatClick = (seat: number) => {
    if (mySeat === null) setMySeat(seat);
    else if (seat === mySeat) {
      setMySeat(null);
      setOpponentSeat(null);
    } else if (selectable(seat)) setOpponentSeat((o) => (o === seat ? null : seat));
  };

  const onSeatRightClick = (seat: number) => {
    setMySeat(seat);
    if (seat === opponentSeat) setOpponentSeat(null);
  };

  useEffect(() => {
    if (tab !== 'main') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') nextHand();
      else if (e.key === 'Escape') resetHand();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, nextHand, resetHand]);

  const configured = Object.keys(settings.positionBaseColors).length > 0;

  return (
    <div className="app">
      <header>
        <h1>Poker Assist <small>ヨコサワレンジ・プリフロップ判定</small></h1>
        <nav>
          <button type="button" className={tab === 'main' ? 'active' : ''} onClick={() => setTab('main')}>判定</button>
          <button type="button" className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>設定</button>
        </nav>
      </header>

      {tab === 'settings' ? (
        <SettingsPanel settings={settings} onChange={setSettings} />
      ) : (
        <main>
          {!configured && (
            <p className="banner">
              レンジ表が未入力です。「設定」タブで、公式のハンドレンジ表を見ながら色とポジションの基準色を入力してください。
            </p>
          )}
          <div className="top">
            <div className="table-pane">
              <TableView
                players={players}
                btnSeat={btnSeat}
                mySeat={mySeat}
                opponentSeat={opponentSeat}
                labelFirstSeatAsUtg={settings.labelFirstSeatAsUtg}
                isSelectable={selectable}
                onSeatClick={onSeatClick}
                onSeatRightClick={onSeatRightClick}
              />
              <p className="hint">
                {mySeat === null
                  ? '自分の席をクリック'
                  : situation === 'vs3bet'
                    ? '3ベットした人の席をクリック'
                    : situation === 'vs4bet'
                      ? 'オープン→4ベットした人の席をクリック'
                      : 'レイズした人がいればその席をクリック（もう一度で解除）'}
                ／自分の席をクリックで選び直し、右クリックで自分の席に変更
              </p>
            </div>
            <div className="grid-pane">
              <HandGrid
                settings={settings}
                selected={hand}
                highlight={highlight}
                onCellDown={(h) => setHand((cur) => (cur === h ? null : h))}
              />
              <p className="legend">
                <span className="lg-me">青枠＝自分の手札</span>
                <span className="lg-range">橙枠＝相手の想定レンジ</span>
              </p>
            </div>
          </div>

          <div className="controls">
            <div className="group">
              <span className="label">人数</span>
              {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((n) => (
                <button key={n} type="button" className={n === players ? 'active' : ''} onClick={() => changePlayers(n)}>
                  {n}
                </button>
              ))}
            </div>
            <div className="group">
              <span className="label">状況</span>
              {SITUATIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={s.id === situation ? 'active' : ''}
                  onClick={() => setSituation(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="group">
              <button type="button" onClick={resetHand} title="Esc">リセット (Esc)</button>
              <button type="button" className="primary" onClick={nextHand} title="N">次のハンド (N)</button>
            </div>
          </div>

          <ResultPanel decision={decision} settings={settings} />
        </main>
      )}
    </div>
  );
}
