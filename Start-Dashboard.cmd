@echo off
setlocal
cd /d "%~dp0"
set "TRADER_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "TRADER_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "node_modules\vite\bin\vite.js" (
  echo Install dependencies first: npm install
  pause
  exit /b 1
)
echo Stock Auto Trader - virtual data only
if not exist "dist\index.html" (
  echo Run Build-Dashboard.cmd first.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:5173 in your browser.
echo Press Ctrl+C to stop.
"%TRADER_NODE%" "node_modules\vite\bin\vite.js" preview --host 127.0.0.1 --port 5173 --strictPort
