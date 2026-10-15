@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Senaryo Asistani'ni acar. Ilk calistirmada kurulum yapar (bir kez, birkac dakika).
where node >nul 2>nul || (echo Node.js bulunamadi. https://nodejs.org adresinden LTS surumunu kurun. & pause & exit /b 1)
if not exist "node_modules" (echo Ilk kurulum yapiliyor... & call npm install || (echo Kurulum basarisiz. & pause & exit /b 1))
if not exist ".env" call npm run anahtar
if not exist "frontend\out\index.html" (echo Arayuz hazirlaniyor... & call npm run build || (pause & exit /b 1))
if not defined PORT set PORT=8765
start "" cmd /c "timeout /t 3 >nul & start http://127.0.0.1:%PORT%"
call npm start
pause
