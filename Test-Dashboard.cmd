@echo off
setlocal
cd /d "%~dp0"
set "TRADER_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "TRADER_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
"%TRADER_NODE%" "node_modules\vitest\vitest.mjs" run
exit /b %ERRORLEVEL%
