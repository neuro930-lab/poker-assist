@echo off
chcp 65001 > nul
title Poker Assist
cd /d "%~dp0"

where node > /dev/null 2> nul
if errorlevel 1 (
  echo Node.js が見つかりません。https://nodejs.org から LTS 版をインストールしてください。
  pause
  exit /b 1
)
where claude > /dev/null 2> nul
if errorlevel 1 (
  echo claude コマンドが見つかりません。Claude Code をインストールして、一度 claude を起動してログインしてください。
  echo （APIキーで使う場合はこのまま続けられます）
)

if exist .git (
  echo 最新版を確認しています...
  git pull --ff-only
)
echo 準備しています...
call npm install --no-audit --no-fund --loglevel=error
if errorlevel 1 (
  echo npm install に失敗しました。
  pause
  exit /b 1
)
call npm run app
pause
