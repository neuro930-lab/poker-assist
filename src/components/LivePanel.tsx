import { useCallback, useEffect, useRef, useState } from 'react';
import { explainApiError, readScreenshot, type ScreenResult, type VisionModel } from '../ai/claude';
import { ChangeDetector, DEFAULT_DETECTOR } from '../live/changeDetector';
import type { Format } from '../logic/yokosawa';

interface Props {
  apiKey: string;
  model: VisionModel;
  format: Format;
  onResult: (r: ScreenResult) => void;
  onNeedKey: () => void;
}

const SAMPLE_MS = 400;
const DIFF_W = 48;
const MAX_EDGE = 1400;
const INTERVALS = [1500, 2500, 4000, 8000];

type Status = 'idle' | 'watching' | 'reading' | 'error';

export function LivePanel({ apiKey, model, format, onResult, onNeedKey }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detector = useRef(new ChangeDetector({ ...DEFAULT_DETECTOR }));
  const busy = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [sharing, setSharing] = useState(false);
  const [auto, setAuto] = useState(true);
  const [interval, setIntervalMs] = useState(DEFAULT_DETECTOR.minIntervalMs);
  const [status, setStatus] = useState<Status>('idle');
  const [info, setInfo] = useState('');
  const [error, setError] = useState('');
  const [reads, setReads] = useState(0);
  const [heroTurn, setHeroTurn] = useState(false);
  const [motion, setMotion] = useState({ change: 0, motion: 0 });

  // 最新の props をタイマーから参照する
  const latest = useRef({ apiKey, model, format, onResult, auto });
  latest.current = { apiKey, model, format, onResult, auto };

  useEffect(() => {
    detector.current.opts = { ...detector.current.opts, minIntervalMs: interval };
  }, [interval]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setSharing(false);
    setStatus('idle');
  }, []);

  useEffect(() => stop, [stop]);

  const start = async () => {
    setError('');
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError('このブラウザは画面共有に対応していません（PCのChrome / Edgeを使ってください）');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
      streamRef.current = stream;
      stream.getVideoTracks()[0].addEventListener('ended', stop);
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      detector.current.reset();
      setSharing(true);
      setStatus('watching');
      setInfo('画面の変化を待っています');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotAllowedError') setError('画面共有がキャンセルされました');
      else setError(explainApiError(e));
    }
  };

  /** 縮小グレースケール（変化検知用） */
  const grabGray = (): Uint8Array | null => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return null;
    const h = Math.max(1, Math.round((DIFF_W * v.videoHeight) / v.videoWidth));
    const c = document.createElement('canvas');
    c.width = DIFF_W;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0, DIFF_W, h);
    const d = ctx.getImageData(0, 0, DIFF_W, h).data;
    const g = new Uint8Array(DIFF_W * h);
    for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
    return g;
  };

  const grabJpeg = (): string | null => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return null;
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', 0.88);
    return url.slice(url.indexOf(',') + 1);
  };

  const read = useCallback(async (gray: Uint8Array | null) => {
    const { apiKey, model, format, onResult } = latest.current;
    if (!apiKey) {
      onNeedKey();
      return;
    }
    const jpeg = grabJpeg();
    if (!jpeg || busy.current) return;
    busy.current = true;
    if (gray) detector.current.markSent(gray, performance.now());
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus('reading');
    setError('');
    const t0 = performance.now();
    try {
      const r = await readScreenshot(apiKey, { base64: jpeg, mediaType: 'image/jpeg' }, format, { model, signal: ac.signal });
      setReads((n) => n + 1);
      const sec = ((performance.now() - t0) / 1000).toFixed(1);
      const time = new Date().toLocaleTimeString('ja-JP');
      setHeroTurn(r.isHeroTurn && r.handInProgress);
      if (r.handInProgress) {
        onResult(r);
        setInfo(`${time} 更新（${sec}秒）${r.warnings.length ? `／${r.warnings.join('、')}` : ''}${r.notes ? `／${r.notes}` : ''}`);
      } else {
        setInfo(`${time} 手札が見えないので待機中（${sec}秒）`);
      }
      setStatus(streamRef.current ? 'watching' : 'idle');
    } catch (e) {
      if (!ac.signal.aborted) {
        setError(explainApiError(e));
        setStatus('error');
      }
    } finally {
      busy.current = false;
    }
  }, [onNeedKey]);

  // 一定間隔でフレームを見て、変化して止まったら読み取る
  useEffect(() => {
    if (!sharing) return;
    const id = window.setInterval(() => {
      const g = grabGray();
      if (!g) return;
      const should = detector.current.push(g, performance.now());
      setMotion({ change: detector.current.lastChange, motion: detector.current.lastMotion });
      if (should && latest.current.auto && !busy.current) void read(g);
    }, SAMPLE_MS);
    return () => window.clearInterval(id);
  }, [sharing, read]);

  // R キーで今すぐ読み取り
  useEffect(() => {
    if (!sharing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey) void read(grabGray());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sharing, read]);

  return (
    <div className="live">
      <div className={`live-video${sharing ? '' : ' empty'}`}>
        <video ref={videoRef} muted playsInline />
        {!sharing && (
          <div className="live-placeholder">
            <p>スマホをPCにミラーリングし、そのウィンドウを共有してください。</p>
            <p className="hint">例：Android は scrcpy、iPhone は Mac の「iPhone ミラーリング」や AirPlay 受信アプリ。「ウィンドウ」タブでミラーリングのウィンドウだけを選ぶと精度が上がります。</p>
          </div>
        )}
        {sharing && (
          <span className={`live-badge ${status}`}>
            {status === 'reading' ? '読み取り中…' : status === 'error' ? 'エラー' : auto ? '監視中' : '一時停止'}
          </span>
        )}
        {heroTurn && <span className="turn-badge">あなたの番</span>}
      </div>
      <div className="row">
        {!sharing ? (
          <button type="button" className="primary" onClick={() => void start()}>画面共有を開始</button>
        ) : (
          <>
            <button type="button" className="primary" disabled={status === 'reading'} onClick={() => void read(grabGray())} title="R">
              今すぐ読み取る (R)
            </button>
            <button type="button" onClick={stop}>共有を停止</button>
          </>
        )}
        <label className="inline">
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> 画面が変わったら自動で読み取る
        </label>
        <label className="inline">
          最短間隔
          <select value={interval} onChange={(e) => setIntervalMs(Number(e.target.value))}>
            {INTERVALS.map((ms) => (
              <option key={ms} value={ms}>{ms / 1000}秒</option>
            ))}
          </select>
        </label>
      </div>
      {!apiKey && <p className="hint">読み取りには Anthropic APIキーが必要です（設定タブ）。</p>}
      {sharing && (
        <p className="hint">
          {info} ／ 読み取り回数 {reads}
          <span className="meter" title="前回の読み取りからの変化量">変化 {(motion.change * 100).toFixed(1)}%</span>
        </p>
      )}
      {error && <p className="warning">⚠ {error}</p>}
    </div>
  );
}
