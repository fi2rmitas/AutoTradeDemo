@echo off
setlocal
cd /d "%~dp0"
set "TRADER_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "TRADER_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%TRADER_NODE%" "node_modules\typescript\bin\tsc" -b
if errorlevel 1 exit /b 1
"%TRADER_NODE%" "node_modules\vite\bin\vite.js" build
if errorlevel 1 exit /b 1
