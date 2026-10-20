@echo off
setlocal
cd /d "%~dp0.."
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 LTS is required. See README.md.
  pause
  exit /b 1
)
if not exist "bridge\dist\bridge\src\main.js" (
  echo Run pnpm install --frozen-lockfile and pnpm build first.
  pause
  exit /b 1
)
node.exe bridge\dist\bridge\src\main.js
if errorlevel 1 pause
