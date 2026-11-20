import { useState } from 'react';
import { CardPicker, CardRow } from './Cards';
import { ALL_POSITIONS, MAX_PLAYERS, MIN_PLAYERS, displayName, positionsFor, type Position } from '../logic/positions';
import { parseCards, cardToString } from '../engine/cards';
import type { GameState, Opponent, OpponentRole, PreflopScenario, StreetAction } from '../engine/state';

const SCENARIOS: { id: PreflopScenario; label: string }[] = [
  { id: 'unopened', label: '誰も参加していない' },
  { id: 'limped', label: 'リンプあり' },
  { id: 'raised', label: 'レイズあり' },
  { id: '3bet', label: '3ベットあり' },
  { id: '4bet', label: '4ベットあり' },
];
const ROLES: { id: OpponentRole; label: string }[] = [
  { id: 'opener', label: 'オープンレイズ' },
  { id: 'caller', label: 'コール' },
  { id: '3bettor', label: '3ベット' },
  { id: '4bettor', label: '4ベット' },
  { id: 'limper', label: 'リンプ' },
  { id: 'blind', label: 'ブラインド（参加のみ）' },
  { id: 'unknown', label: '不明' },
];
const ACTIONS: { id: StreetAction; label: string }[] = [
  { id: 'none', label: 'まだ／自分が先' },
  { id: 'check', label: 'チェック' },
  { id: 'bet', label: 'ベット' },
  { id: 'raise', label: 'レイズ' },
];

interface Props {
  state: GameState;
  labelFirstSeatAsUtg: boolean;
  onChange: (s: GameState) => void;
}

function Num({ value, onChange, step = 0.5 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 0) onChange(v);
      }}
    />
  );
}

export function StateEditor({ state, labelFirstSeatAsUtg, onChange }: Props) {
  const [target, setTarget] = useState<'hero' | 'board'>('hero');
  const set = (patch: Partial<GameState>) => onChange({ ...state, ...patch });
  const positions = positionsFor(state.players);
  const name = (p: Position) => displayName(p, state.players, labelFirstSeatAsUtg);
  const used = new Set([...state.heroCards, ...state.board]);
  const street = state.board.length >= 5 ? 'リバー' : state.board.length === 4 ? 'ターン' : state.board.length >= 3 ? 'フロップ' : 'プリフロップ';
  const bbUnit = state.bigBlind === 1 ? 'BB' : 'チップ';

  const setOpp = (i: number, patch: Partial<Opponent>) =>
    set({ opponents: state.opponents.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const freePositions = positions.filter((p) => p !== state.heroPosition && !state.opponents.some((o) => o.position === p));

  return (
    <div className="state-editor">
      <div className="field-grid">
        <label>
          人数
          <select
            value={state.players}
            onChange={(e) => {
              const players = Number(e.target.value);
              const valid = positionsFor(players);
              set({
                players,
                heroPosition: state.heroPosition && valid.includes(state.heroPosition) ? state.heroPosition : null,
                opponents: state.opponents.filter((o) => valid.includes(o.position)),
              });
            }}
          >
            {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((n) => (
              <option key={n} value={n}>{n}人</option>
            ))}
          </select>
        </label>
        <label>
          自分のポジション
          <select
            value={state.heroPosition ?? ''}
            onChange={(e) => {
              const p = (e.target.value || null) as Position | null;
              set({ heroPosition: p, opponents: state.opponents.filter((o) => o.position !== p) });
            }}
          >
            <option value="">（選択）</option>
            {positions.map((p) => (
              <option key={p} value={p}>{name(p)}</option>
            ))}
          </select>
        </label>
        <label>
          1BBの額
          <Num value={state.bigBlind} onChange={(v) => set({ bigBlind: v || 1 })} step={1} />
        </label>
        <label>
          自分のスタック（{bbUnit}）
          <Num value={state.heroStack} onChange={(v) => set({ heroStack: v })} step={1} />
        </label>
        <label>
          ポット（{bbUnit}）
          <Num value={state.pot} onChange={(v) => set({ pot: v })} />
        </label>
        <label>
          コール額（{bbUnit}・0＝チェック可）
          <Num value={state.toCall} onChange={(v) => set({ toCall: v })} />
        </label>
      </div>

      <div className="cards-input">
        <div className={`cards-target${target === 'hero' ? ' active' : ''}`}>
          <button type="button" onClick={() => setTarget('hero')}>手札</button>
          <CardRow cards={state.heroCards} placeholder="2枚" />
          <input
            aria-label="手札（文字入力）"
            placeholder="例: AhKd"
            value={state.heroCards.join(' ')}
            onFocus={() => setTarget('hero')}
            onChange={(e) => set({ heroCards: parseCards(e.target.value).slice(0, 2).map(cardToString) })}
          />
        </div>
        <div className={`cards-target${target === 'board' ? ' active' : ''}`}>
          <button type="button" onClick={() => setTarget('board')}>ボード（{street}）</button>
          <CardRow cards={state.board} placeholder="なし（プリフロップ）" />
          <input
            aria-label="ボード（文字入力）"
            placeholder="例: Ks7c2d"
            value={state.board.join(' ')}
            onFocus={() => setTarget('board')}
            onChange={(e) => set({ board: parseCards(e.target.value).slice(0, 5).map(cardToString) })}
          />
        </div>
        <CardPicker
          used={used}
          selected={target === 'hero' ? state.heroCards : state.board}
          max={target === 'hero' ? 2 : 5}
          onChange={(cards) => set(target === 'hero' ? { heroCards: cards } : { board: cards })}
        />
      </div>

      <div className="field-grid">
        <label>
          プリフロップ
          <select value={state.preflop} onChange={(e) => set({ preflop: e.target.value as PreflopScenario })}>
            {SCENARIOS.map((x) => (
              <option key={x.id} value={x.id}>{x.label}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={state.heroIsAggressor} onChange={(e) => set({ heroIsAggressor: e.target.checked })} />
          プリフロップ最後のレイズは自分
        </label>
        {state.board.length >= 3 && (
          <>
            <label>
              このストリートの相手
              <select value={state.villainAction} onChange={(e) => set({ villainAction: e.target.value as StreetAction })}>
                {ACTIONS.map((x) => (
                  <option key={x.id} value={x.id}>{x.label}</option>
                ))}
              </select>
            </label>
            <label>
              前のストリートで相手がベットした回数
              <Num value={state.villainBetsEarlier} onChange={(v) => set({ villainBetsEarlier: Math.round(v) })} step={1} />
            </label>
          </>
        )}
      </div>

      <h3>残っている相手</h3>
      {state.opponents.length === 0 && <p className="hint">未入力のときは、状況から1人を仮定して計算します。</p>}
      <ul className="opponents">
        {state.opponents.map((o, i) => (
          <li key={i}>
            <select value={o.position} onChange={(e) => setOpp(i, { position: e.target.value as Position })}>
              {ALL_POSITIONS.filter((p) => positions.includes(p) && (p === o.position || freePositions.includes(p))).map((p) => (
                <option key={p} value={p}>{name(p)}</option>
              ))}
            </select>
            <select value={o.role} onChange={(e) => setOpp(i, { role: e.target.value as OpponentRole })}>
              {ROLES.map((r) => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            <label className="inline">
              スタック
              <input
                type="number"
                min={0}
                value={o.stack ?? ''}
                placeholder="不明"
                onChange={(e) => setOpp(i, { stack: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </label>
            <button type="button" onClick={() => set({ opponents: state.opponents.filter((_, j) => j !== i) })} aria-label="削除">
              ×
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={freePositions.length === 0}
        onClick={() =>
          set({ opponents: [...state.opponents, { position: freePositions[freePositions.length - 1], stack: null, role: 'unknown' }] })
        }
      >
        ＋ 相手を追加
      </button>
    </div>
  );
}
