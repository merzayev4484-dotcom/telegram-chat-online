@echo off
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js o'rnatilmagan! https://nodejs.org dan "LTS" ni yuklab o'rnating, keyin bu faylni qayta oching.
  pause
  exit /b
)
set OWNER_EMAIL=ega@test.com
set DEV_LOGIN=1
set PORT=3000
echo Server ishga tushmoqda... Brauzerda oching: http://localhost:3000
echo (Ega sifatida ega@test.com bilan kiring. To'xtatish: Ctrl+C)
start "" http://localhost:3000
node server.js
pause
