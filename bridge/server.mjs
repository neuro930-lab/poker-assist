// Poker Assist をPCだけで動かすためのサーバー（中継プログラム）
//
//   npm run app   または   start-poker-assist.bat をダブルクリック
//
// - dist/（ビルドしたアプリ）を http://127.0.0.1:5175 で配信し、ブラウザを開く
// - /api/read  : 画面の画像を、PCの Claude Code CLI（Maxプラン等のログイン）に読ませて JSON を返す
// - /api/coach : AIコーチの解説を、同じく CLI で作って少しずつ返す
//
// 速くするために、claude を「起動したまま」にして画像を次々に送る（毎回の起動待ちをなくす）。
// 履歴がたまると遅くなるので、数回ごとに裏で起動しておいた新しい claude と入れ替える。
// このサーバーは 127.0.0.1 だけで待ち受け、同じアプリ以外からの API 呼び出しは断る。

import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(HERE, '..', 'dist');
const PORT = Number(process.env.PORT || 5175);
const HOST = '127.0.0.1';
const IS_WIN = process.platform === 'win32';
const MAX_TURNS = 6; // この回数読んだら新しい claude に入れ替える
const READ_TIMEOUT_MS = 60_000;
const MODELS = new Set(['haiku', 'sonnet', 'opus']);
const WORK_DIR = join(tmpdir(), 'poker-assist-claude'); // CLAUDE.md などを読み込まない空の作業フォルダ
mkdirSync(WORK_DIR, { recursive: true });

const SYSTEM = 'You read poker app screenshots and reply with exactly one JSON object, no prose.';

// ---------------- claude の起動 ----------------

/** APIキーが環境変数にあると従量課金になるので外し、ログイン（Maxプラン等）を使わせる */
function childEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  return env;
}

const q = (a) => (a === '' ? '""' : /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);

/** claude を起動する。Windows の claude.cmd でも動くよう、Windows ではシェル経由 */
function spawnClaude(args) {
  if (IS_WIN) {
    return spawn(['claude', ...args].map(q).join(' '), { cwd: WORK_DIR, env: childEnv(), shell: true, windowsHide: true });
  }
  return spawn('claude', args, { cwd: WORK_DIR, env: childEnv() });
}

function claudeVersion() {
  try {
    const out = IS_WIN
      ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'claude --version'], { env: childEnv(), timeout: 20_000 })
      : execFileSync('claude', ['--version'], { env: childEnv(), timeout: 20_000 });
    return String(out).trim();
  } catch {
    return null;
  }
}

/** stdout の JSON 行を1行ずつ渡す */
function onJsonLines(stream, cb) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        cb(JSON.parse(line));
      } catch {
        // JSON 以外の行は無視
      }
    }
  });
}

const userMessage = (content) => JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';

/** 起動したままの claude 1つ */
class Worker {
  constructor(model, instructions) {
    this.model = model;
    this.turns = 0;
    this.dead = false;
    this.pending = null; // { resolve, reject, timer }
    this.stderr = '';
    this.proc = spawnClaude([
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', model,
      '--effort', 'low',
      '--tools', '',
      '--system-prompt', SYSTEM,
      '--no-session-persistence',
    ]);
    this.proc.stderr.setEncoding('utf8');
    this.proc.stderr.on('data', (d) => (this.stderr = (this.stderr + d).slice(-2000)));
    this.proc.on('exit', (code) => {
      this.dead = true;
      this.fail(new Error(`claude が終了しました（コード ${code}）${this.stderr ? `：${this.stderr.trim().slice(-300)}` : ''}`));
    });
    this.proc.on('error', (e) => {
      this.dead = true;
      this.fail(new Error(`claude を起動できません：${e.message}（Claude Code がインストールされ、ログイン済みか確認してください）`));
    });
    onJsonLines(this.proc.stdout, (msg) => {
      if (msg.type !== 'result' || !this.pending) return;
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      if (msg.is_error || msg.subtype !== 'success') p.reject(new Error(`claude のエラー：${msg.result ?? msg.subtype ?? '不明'}`));
      else p.resolve(String(msg.result ?? ''));
    });
    // 指示文を先に読ませておく（最初の画像も速くなる）
    this.warm = this.send([{ type: 'text', text: `${instructions}\n\n準備ができたら {"ready":true} とだけ返してください。` }]).catch(() => {});
  }

  fail(err) {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(err);
  }

  send(content) {
    if (this.dead) return Promise.reject(new Error('claude が終了しています'));
    if (this.pending) return Promise.reject(new Error('前の読み取りが終わっていません'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('読み取りが時間切れになりました'));
        this.kill();
      }, READ_TIMEOUT_MS);
      this.pending = { resolve, reject, timer };
      this.proc.stdin.write(userMessage(content));
    });
  }

  async read(image) {
    await this.warm;
    this.turns++;
    return this.send([
      { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
      { type: 'text', text: '次の画面です。最初の指示どおり、JSONオブジェクトだけを出力してください。' },
    ]);
  }

  kill() {
    this.dead = true;
    try {
      if (IS_WIN && this.proc.pid) spawn('taskkill', ['/pid', String(this.proc.pid), '/T', '/F'], { windowsHide: true });
      else this.proc.kill();
    } catch {
      // 既に終了
    }
  }
}

/** モデルごとに「使用中」と「待機中（起動済み）」を持つ */
const pools = new Map();

function pool(model, instructions) {
  let p = pools.get(model);
  if (!p || p.instructions !== instructions) {
    if (p) {
      p.active?.kill();
      p.standby?.kill();
    }
    p = { instructions, active: null, standby: null };
    pools.set(model, p);
  }
  return p;
}

function takeWorker(model, instructions) {
  const p = pool(model, instructions);
  if (!p.active || p.active.dead || p.active.turns >= MAX_TURNS) {
    p.active?.kill();
    p.active = p.standby && !p.standby.dead ? p.standby : new Worker(model, instructions);
    p.standby = null;
  }
  // 入れ替えの少し前に、次の claude を裏で起動しておく
  if (!p.standby && p.active.turns >= MAX_TURNS - 2) p.standby = new Worker(model, instructions);
  return p.active;
}

let busy = false;

async function handleRead(body) {
  const { model, instructions, image } = body;
  if (!MODELS.has(model)) throw httpError(400, 'model が不正です');
  if (typeof instructions !== 'string' || instructions.length > 20_000) throw httpError(400, 'instructions が不正です');
  if (!image || typeof image.base64 !== 'string' || !/^image\/(png|jpeg|webp|gif)$/.test(image.mediaType)) {
    throw httpError(400, 'image が不正です');
  }
  if (busy) throw httpError(409, '前の読み取りが終わっていません');
  busy = true;
  const t0 = Date.now();
  try {
    const w = takeWorker(model, instructions);
    try {
      return { text: await w.read(image), ms: Date.now() - t0 };
    } catch (e) {
      w.kill(); // 次は新しい claude で
      throw e;
    }
  } finally {
    busy = false;
  }
}

/** 画面共有を始めたときなどに呼ばれ、claude を先に起動して指示文を読ませておく */
function handleWarm(body) {
  const { model, instructions } = body;
  if (!MODELS.has(model) || typeof instructions !== 'string' || instructions.length > 20_000) throw httpError(400, '不正な指定です');
  if (!busy) takeWorker(model, instructions);
  return { ok: true };
}

/** AIコーチ：1回ごとに Opus を起動し、文章を少しずつ返す */
function handleCoach(body, res) {
  if (typeof body.prompt !== 'string' || body.prompt.length > 50_000) throw httpError(400, 'prompt が不正です');
  const proc = spawnClaude([
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--model', 'opus',
    '--effort', 'high',
    '--tools', '',
    '--system-prompt', 'You are a world-class poker coach. Answer in Japanese.',
    '--no-session-persistence',
  ]);
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  let wrote = false;
  let stderr = '';
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-1000)));
  onJsonLines(proc.stdout, (msg) => {
    if (msg.type === 'stream_event' && msg.event?.type === 'content_block_delta' && msg.event.delta?.type === 'text_delta') {
      wrote = true;
      res.write(msg.event.delta.text);
    } else if (msg.type === 'result') {
      if (!wrote && msg.result) res.write(String(msg.result));
      if (msg.is_error) res.write(`\n\n（エラー：${msg.result ?? msg.subtype}）`);
      res.end();
    }
  });
  proc.on('exit', (code) => {
    if (!res.writableEnded) {
      if (code) res.write(`\n\n（claude が終了しました：コード ${code} ${stderr.trim().slice(-200)}）`);
      res.end();
    }
  });
  proc.on('error', (e) => {
    if (!res.writableEnded) res.end(`（claude を起動できません：${e.message}）`);
  });
  res.on('close', () => {
    if (!proc.killed) proc.kill();
  });
  proc.stdin.write(userMessage([{ type: 'text', text: body.prompt }]));
  proc.stdin.end();
}

// ---------------- HTTP ----------------

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${HOST}`);
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return send(res, 403, 'forbidden');
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) return send(res, 500, 'dist/ がありません。先に npm run build してください');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

function send(res, status, body) {
  const json = typeof body !== 'string';
  res.writeHead(status, { 'content-type': json ? 'application/json' : 'text/plain; charset=utf-8' });
  res.end(json ? JSON.stringify(body) : body);
}

/** 他のWebサイトからこのサーバーのAPIを呼ばせない（同じアプリと開発用のVite以外は拒否） */
function allowedOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true; // 同一オリジンの GET 等
  return [`http://${HOST}:${PORT}`, `http://localhost:${PORT}`, 'http://localhost:5173', 'http://127.0.0.1:5173'].includes(o);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 15 * 1024 * 1024) throw httpError(413, '画像が大きすぎます');
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

let version = null;

const server = createServer(async (req, res) => {
  try {
    if (!req.url.startsWith('/api/')) return serveStatic(req, res);
    if (!allowedOrigin(req)) return send(res, 403, { error: 'このアプリ以外からは使えません' });
    if (req.url === '/api/health') return send(res, 200, { ok: version !== null, version });
    if (req.method !== 'POST') return send(res, 405, { error: 'POST のみ' });
    if (!(req.headers['content-type'] ?? '').includes('application/json')) return send(res, 415, { error: 'JSON で送ってください' });
    const body = await readBody(req);
    if (req.url === '/api/read') return send(res, 200, await handleRead(body));
    if (req.url === '/api/warm') return send(res, 200, handleWarm(body));
    if (req.url === '/api/coach') return handleCoach(body, res);
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status ?? 500, { error: e.message ?? String(e) });
    else res.end();
  }
});

version = claudeVersion();
if (!version) {
  console.error('⚠ claude コマンドが見つかりません。Claude Code をインストールしてログインしてください（npm i -g @anthropic-ai/claude-code → claude）');
}

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}/`;
  console.log(`Poker Assist: ${url}`);
  console.log(version ? `PCのClaude: ${version}（APIキーの環境変数は使わず、ログイン中のプランで動かします）` : 'PCのClaude: 未接続');
  console.log('終了するには このウィンドウを閉じるか Ctrl+C');
  if (!process.env.NO_OPEN) {
    const opener = IS_WIN ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try {
      spawn(opener[0], opener[1], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch {
      // ブラウザは手で開いてもらう
    }
  }
});

const shutdown = () => {
  for (const p of pools.values()) {
    p.active?.kill();
    p.standby?.kill();
  }
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
