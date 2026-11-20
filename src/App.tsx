import { useEffect, useMemo, useState } from 'react';
import { VISION_MODELS, loadApiKey, loadVisionModel, saveApiKey, saveVisionModel, type ScreenResult, type VisionModel } from './ai/claude';
import { AdvicePanel } from './components/AdvicePanel';
import { CoachPanel } from './components/CoachPanel';
import { LivePanel } from './components/LivePanel';
import { mergeWithPrevious } from './ai/screen';
import { LOCAL_MODELS, bridgeHealth, type BridgeStatus, type LocalModel } from './ai/local';
import { loadLocalModel, loadReadMode, saveLocalModel, saveReadMode, type ReadMode, type Reader } from './ai/reader';
import { PreflopTrainer } from './components/PreflopTrainer';
import { ScreenshotPanel } from './components/ScreenshotPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { StateEditor } from './components/StateEditor';
import { YokosawaView } from './components/YokosawaView';
import { advise } from './engine/advisor';
import { emptyState, type GameState } from './engine/state';
import { loadSettings, saveSettings, type Settings } from './logic/settings';
import { FORMAT_LABELS, type Format } from './logic/yokosawa';

type Tab = 'analyze' | 'trainer' | 'settings';
const FORMAT_KEY = 'poker-assist.format.v1';

function loadFormat(): Format {
  try {
    return localStorage.getItem(FORMAT_KEY) === 'tournament' ? 'tournament' : 'ring';
  } catch {
    return 'ring';
  }
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() =>
    typeof location !== 'undefined' && location.hash === '#settings' ? 'settings' : 'analyze',
  );
  const [format, setFormat] = useState<Format>(loadFormat);
  const [settings, setSettings] = useState<Record<Format, Settings>>(() => ({
    ring: loadSettings('ring'),
    tournament: loadSettings('tournament'),
  }));
  const [state, setState] = useState<GameState>(() => emptyState(loadFormat()));
  const [apiKey, setApiKey] = useState(loadApiKey);
  const [showRange, setShowRange] = useState(true);
  const [visionModel, setVisionModel] = useState<VisionModel>(loadVisionModel);
  const [input, setInput] = useState<'live' | 'image'>('live');
  const [bridge, setBridge] = useState<BridgeStatus>({ ok: false });
  const [savedMode, setSavedMode] = useState<ReadMode | null>(loadReadMode);
  const [localModel, setLocalModel] = useState<LocalModel>(loadLocalModel);

  // 中継プログラム（PCのClaude）につながっているか。つながっていなければ時々確認し直す
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const st = await bridgeHealth();
      if (alive) setBridge(st);
    };
    void check();
    const id = window.setInterval(check, 15000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // 明示的に選んでいなければ、PCのClaudeが使えるときはそちらを優先
  const mode: ReadMode = savedMode ?? (bridge.ok ? 'local' : 'api');
  const reader: Reader = { mode, apiKey, apiModel: visionModel, localModel, bridgeOk: bridge.ok };

  useEffect(() => saveSettings('ring', settings.ring), [settings.ring]);
  useEffect(() => saveSettings('tournament', settings.tournament), [settings.tournament]);
  useEffect(() => {
    try {
      localStorage.setItem(FORMAT_KEY, format);
    } catch {
      // 保存できなくても動作は続ける
    }
  }, [format]);

  const changeFormat = (f: Format) => {
    setFormat(f);
    setState((s) => ({ ...s, format: f }));
  };

  const advice = useMemo(() => advise({ ...state, format }, settings), [state, format, settings]);

  const onScreen = (r: ScreenResult) => {
    const next: GameState = { ...emptyState(r.state.format ?? format), ...r.state };
    if (next.format !== format) setFormat(next.format);
    setState((prev) => mergeWithPrevious(prev, next));
  };

  const fmtButtons = (
    <div className="format-toggle" role="group" aria-label="ゲームの種類">
      {(['ring', 'tournament'] as Format[]).map((f) => (
        <button key={f} type="button" className={f === format ? 'active' : ''} onClick={() => changeFormat(f)}>
          {FORMAT_LABELS[f]}
        </button>
      ))}
    </div>
  );

  return (
    <div className="app">
      <header>
        <h1>
          Poker Assist <small>画面解析 × 最適プレー × ヨコサワレンジ</small>
        </h1>
        {fmtButtons}
        <nav>
          <button type="button" className={tab === 'analyze' ? 'active' : ''} onClick={() => setTab('analyze')}>解析</button>
          <button type="button" className={tab === 'trainer' ? 'active' : ''} onClick={() => setTab('trainer')}>プリフロップ練習</button>
          <button type="button" className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>設定</button>
        </nav>
      </header>

      {tab === 'analyze' && (
        <main className={`analyze${input === 'live' ? ' live-mode' : ''}`}>
          <div className="col">
            <section className="panel">
              <h2>
                ① ゲーム画面
                <span className="input-tabs" role="group" aria-label="入力方法">
                  <button type="button" className={input === 'live' ? 'active' : ''} onClick={() => setInput('live')}>
                    リアルタイム（画面共有）
                  </button>
                  <button type="button" className={input === 'image' ? 'active' : ''} onClick={() => setInput('image')}>
                    画像を貼り付け
                  </button>
                </span>
              </h2>
              {input === 'live' ? (
                <LivePanel reader={reader} format={format} onResult={onScreen} onNeedKey={() => setTab('settings')} />
              ) : (
                <ScreenshotPanel reader={reader} format={format} onResult={onScreen} onNeedKey={() => setTab('settings')} />
              )}
            </section>
            <section className="panel">
              <details className="editor-details" open={input === 'image'}>
                <summary>局面（読み取り結果の確認・手入力）</summary>
                <button type="button" className="small-btn" onClick={() => setState(emptyState(format))}>クリア</button>
                <StateEditor
                  state={state}
                  labelFirstSeatAsUtg={settings[format].labelFirstSeatAsUtg}
                  onChange={setState}
                />
              </details>
            </section>
          </div>
          <div className="col">
            <AdvicePanel advice={advice} />
            <YokosawaView
              format={format}
              settings={settings[format]}
              advice={advice}
              showRange={showRange}
              onToggleRange={setShowRange}
            />
            <CoachPanel reader={reader} state={{ ...state, format }} advice={advice} onNeedKey={() => setTab('settings')} />
          </div>
        </main>
      )}

      {tab === 'trainer' && <PreflopTrainer settings={settings[format]} active />}

      {tab === 'settings' && (
        <>
          <section className="panel api-key">
            <h2>画面の読み取り・AIコーチをどこで動かすか</h2>
            <div className="row">
              <label className="inline">
                <input
                  type="radio"
                  name="read-mode"
                  checked={mode === 'local'}
                  onChange={() => { setSavedMode('local'); saveReadMode('local'); }}
                />
                PCのClaude（Claude Code CLI・Maxプラン等。APIキー不要）
              </label>
              <label className="inline">
                <input
                  type="radio"
                  name="read-mode"
                  checked={mode === 'api'}
                  onChange={() => { setSavedMode('api'); saveReadMode('api'); }}
                />
                Anthropic APIキー
              </label>
            </div>
            {mode === 'local' && (
              <>
                <p className={bridge.ok ? 'note' : 'warning'}>
                  {bridge.ok
                    ? `✓ PCのClaudeに接続中${bridge.version ? `（${bridge.version}）` : ''}`
                    : '⚠ 接続されていません。start-poker-assist.bat をダブルクリックして起動したアプリで開いてください（GitHub Pages のサイトからは使えません）'}
                </p>
                <label className="inline">
                  読み取りのモデル
                  <select value={localModel} onChange={(e) => { const m = e.target.value as LocalModel; setLocalModel(m); saveLocalModel(m); }}>
                    {LOCAL_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </select>
                </label>
                <p className="hint">プランの利用枠を使います（追加料金なし）。AIコーチは Opus で動きます。</p>
              </>
            )}
          </section>
          <section className="panel api-key" hidden={mode !== 'api'}>
            <h2>Anthropic APIキー（画面解析・AIコーチ用）</h2>
            <p className="hint">
              キーはこのブラウザ内（localStorage）にだけ保存され、api.anthropic.com に直接送られます。自分のPCで使う前提です。共有PCでは使い終わったら消してください。
            </p>
            <div className="row">
              <input
                type="password"
                autoComplete="off"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value.trim());
                  saveApiKey(e.target.value.trim());
                }}
              />
              {apiKey && (
                <button type="button" className="danger" onClick={() => { setApiKey(''); saveApiKey(''); }}>
                  キーを消す
                </button>
              )}
            </div>
            <h2>画面読み取りのモデル</h2>
            <select value={visionModel} onChange={(e) => { const m = e.target.value as VisionModel; setVisionModel(m); saveVisionModel(m); }}>
              {VISION_MODELS.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <p className="hint">リアルタイムで遅く感じるときは Sonnet / Haiku に。読み間違いが多いときは Opus に。AIコーチは常に Opus 5.5 です。</p>
          </section>
          <SettingsPanel
            format={format}
            settings={settings[format]}
            onChange={(s) => setSettings((all) => ({ ...all, [format]: s }))}
          />
        </>
      )}
    </div>
  );
}
