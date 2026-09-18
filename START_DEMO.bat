@echo off
cd /d %~dp0
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.x is required. Install it first.
  pause
  exit /b 1
)
set OPEN_BROWSER=1
node scripts/demo.js
pause
