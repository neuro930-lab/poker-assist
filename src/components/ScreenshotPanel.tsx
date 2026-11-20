import { useCallback, useEffect, useRef, useState } from 'react';
import { explainApiError, type ScreenResult } from '../ai/claude';
import { readScreen, readerNotReadyMessage, readerReady, type Reader } from '../ai/reader';
import type { Format } from '../logic/yokosawa';

type Media = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
const MEDIA: Media[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

interface Props {
  reader: Reader;
  format: Format;
  onResult: (r: ScreenResult) => void;
  onNeedKey: () => void;
}

/** 画像を最大辺 1600px に縮小して base64 にする（送信量とコストを抑える） */
async function toBase64(file: Blob): Promise<{ base64: string; mediaType: Media; url: string }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((ok, ng) => {
    img.onload = () => ok();
    img.onerror = () => ng(new Error('画像を読み込めませんでした'));
    img.src = url;
  });
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  if (scale === 1 && MEDIA.includes(file.type as Media)) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { base64: btoa(bin), mediaType: file.type as Media, url };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/png');
  return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/png', url };
}

export function ScreenshotPanel({ reader, format, onResult, onNeedKey }: Props) {
  const [image, setImage] = useState<{ base64: string; mediaType: Media; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string[]>([]);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (file: Blob) => {
    setError('');
    setMessage([]);
    try {
      setImage(await toBase64(file));
    } catch (e) {
      setError(explainApiError(e));
    }
  }, []);

  // Ctrl+V でクリップボードの画像を貼り付け
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void load(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [load]);

  const analyze = async () => {
    if (!image) return;
    if (!readerReady(reader)) {
      onNeedKey();
      return;
    }
    setBusy(true);
    setError('');
    setMessage([]);
    try {
      const r = await readScreen(reader, image, format);
      onResult(r);
      setMessage([`読み取り完了${r.notes ? `：${r.notes}` : ''}`, ...r.warnings]);
    } catch (e) {
      setError(explainApiError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screenshot">
      <div
        className={`drop${image ? ' has-image' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void load(f);
        }}
        onClick={() => fileRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}
      >
        {image ? (
          <img src={image.url} alt="読み込んだスクリーンショット" />
        ) : (
          <p>
            スクリーンショットを <b>Ctrl+V で貼り付け</b>／ドラッグ＆ドロップ／クリックして選択
          </p>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void load(f);
          e.target.value = '';
        }}
      />
      <div className="row">
        <button type="button" className="primary" disabled={!image || busy} onClick={() => void analyze()}>
          {busy ? '解析中…' : 'AIで画面を解析'}
        </button>
        {image && (
          <button type="button" onClick={() => setImage(null)} disabled={busy}>
            画像を消す
          </button>
        )}
      </div>
      {!readerReady(reader) && <p className="hint">{readerNotReadyMessage(reader)}。読み取りなしでも、下の欄に手入力すれば判定できます。</p>}
      {error && <p className="warning">⚠ {error}</p>}
      {message.map((m) => (
        <p key={m} className="note">{m}</p>
      ))}
    </div>
  );
}
