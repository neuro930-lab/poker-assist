import { useRef, useState } from 'react';
import { ALL_POSITIONS } from '../logic/positions';
import { defaultSettings, exportSettings, parseSettings, type Settings } from '../logic/settings';
import { HandGrid, textColorFor } from './HandGrid';

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function SettingsPanel({ settings, onChange }: Props) {
  const [brush, setBrush] = useState(settings.colorOrder[1]?.name ?? settings.colorOrder[0].name);
  const [message, setMessage] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const grey = settings.colorOrder[0].name;

  const paint = (hand: string) => {
    if (settings.handColors[hand] === brush || (brush === grey && !settings.handColors[hand])) return;
    const handColors = { ...settings.handColors };
    if (brush === grey) delete handColors[hand];
    else handColors[hand] = brush;
    onChange({ ...settings, handColors });
  };

  const moveColor = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= settings.colorOrder.length) return;
    const colorOrder = [...settings.colorOrder];
    [colorOrder[i], colorOrder[j]] = [colorOrder[j], colorOrder[i]];
    onChange({ ...settings, colorOrder });
  };

  const download = () => {
    const blob = new Blob([exportSettings(settings)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `poker-assist-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const upload = async (file: File) => {
    try {
      const { settings: s, warnings } = parseSettings(JSON.parse(await file.text()));
      onChange(s);
      setMessage([`「${file.name}」を読み込みました`, ...warnings]);
    } catch (e) {
      setMessage([`読み込みに失敗しました：${e instanceof Error ? e.message : String(e)}`]);
    }
  };

  const filled = Object.keys(settings.handColors).length;

  return (
    <div className="settings">
      <section className="settings-editor">
        <h2>レンジ表エディタ</h2>
        <p className="hint">
          色を選んでマスをクリック（ドラッグで連続して塗れます）。入力済み {filled}/169、未入力はグレー扱い。
        </p>
        <div className="palette">
          {settings.colorOrder.map((c, lv) => (
            <button
              key={c.name}
              type="button"
              className={c.name === brush ? 'active' : ''}
              style={{ background: c.hex, color: textColorFor(c.hex) }}
              onClick={() => setBrush(c.name)}
            >
              {lv}：{c.name}
            </button>
          ))}
        </div>
        <HandGrid settings={settings} onCellDown={paint} onCellDrag={paint} />
        <button
          type="button"
          className="danger"
          onClick={() => confirm('169マスの色をすべて消しますか？') && onChange({ ...settings, handColors: {} })}
        >
          表をすべてクリア
        </button>
      </section>

      <section className="settings-side">
        <h2>ポジションの参加基準色</h2>
        <table className="form-table">
          <tbody>
            {ALL_POSITIONS.filter((p) => p !== 'BB').map((pos) => (
              <tr key={pos}>
                <th>{pos}</th>
                <td>
                  <select
                    value={settings.positionBaseColors[pos] ?? ''}
                    onChange={(e) => {
                      const positionBaseColors = { ...settings.positionBaseColors };
                      if (e.target.value) positionBaseColors[pos] = e.target.value;
                      else delete positionBaseColors[pos];
                      onChange({ ...settings, positionBaseColors });
                    }}
                  >
                    <option value="">（未設定）</option>
                    {settings.colorOrder.slice(1).map((c) => (
                      <option key={c.name} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>判定の設定</h2>
        <table className="form-table">
          <tbody>
            <tr>
              <th>BBのコール基準色</th>
              <td>
                <select
                  value={settings.bbCallColor}
                  onChange={(e) => onChange({ ...settings, bbCallColor: e.target.value })}
                >
                  {settings.colorOrder.slice(1).map((c) => (
                    <option key={c.name} value={c.name}>{c.name}以上</option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <th>リレイズ（3ベット）に必要な段数</th>
              <td>
                <StepInput value={settings.reraiseStep} onChange={(v) => onChange({ ...settings, reraiseStep: v })} />
              </td>
            </tr>
            <tr>
              <th>4ベットに必要な段数（3ベット下限から）</th>
              <td>
                <StepInput value={settings.fourBetStep} onChange={(v) => onChange({ ...settings, fourBetStep: v })} />
              </td>
            </tr>
            <tr>
              <th>4〜6人のとき先頭の席を「UTG」と表示</th>
              <td>
                <input
                  type="checkbox"
                  checked={settings.labelFirstSeatAsUtg}
                  onChange={(e) => onChange({ ...settings, labelFirstSeatAsUtg: e.target.checked })}
                />
              </td>
            </tr>
          </tbody>
        </table>

        <h2>色の順番と表示色</h2>
        <p className="hint">上ほど弱い（0＝参加しない）。並べ替えると強さレベルが変わります。</p>
        <ul className="color-order">
          {settings.colorOrder.map((c, i) => (
            <li key={c.name}>
              <span className="lv">{i}</span>
              <input
                type="color"
                value={c.hex}
                onChange={(e) => {
                  const colorOrder = settings.colorOrder.map((x, j) => (j === i ? { ...x, hex: e.target.value } : x));
                  onChange({ ...settings, colorOrder });
                }}
              />
              <span className="name">{c.name}</span>
              <button type="button" onClick={() => moveColor(i, -1)} disabled={i === 0}>↑</button>
              <button type="button" onClick={() => moveColor(i, 1)} disabled={i === settings.colorOrder.length - 1}>↓</button>
            </li>
          ))}
        </ul>

        <h2>書き出し／読み込み</h2>
        <p className="hint">設定はブラウザに自動保存されます。バックアップや別PCへの移行にはJSONファイルを使ってください。</p>
        <div className="row">
          <button type="button" onClick={download}>JSONを書き出す</button>
          <button type="button" onClick={() => fileRef.current?.click()}>JSONを読み込む</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="danger"
            onClick={() => confirm('すべての設定を初期状態に戻しますか？') && onChange(defaultSettings())}
          >
            初期状態に戻す
          </button>
        </div>
        {message.map((m) => (
          <p key={m} className="note">{m}</p>
        ))}
      </section>
    </div>
  );
}

function StepInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      min={1}
      max={6}
      value={value}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (Number.isInteger(v) && v >= 1) onChange(v);
      }}
    />
  );
}
