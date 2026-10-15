@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Senaryo Asistani
rem Senaryo Asistani'ni tek tikla acar. Ilk calistirmada gerekenleri kendisi kurar (bir kez, birkac dakika).
rem Node.js yoksa (ya da eskiyse) yonetici izni gerektirmeden bu klasore tasinabilir surumunu indirir.
set NODE_VER=24.20.0

if exist ".node\node.exe" goto yerel
where node >nul 2>nul && node -e "process.exit(+process.versions.node.split('.')[0]>=22?0:1)" >nul 2>nul && goto hazir

echo Node.js bulunamadi; bu klasore indiriliyor (bir kez, yaklasik 30 MB)...
set ARCH=x64
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set ARCH=arm64
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $n='node-v%NODE_VER%-win-%ARCH%'; $z=Join-Path $env:TEMP 'sa-node.zip'; Invoke-WebRequest \"https://nodejs.org/dist/v%NODE_VER%/$n.zip\" -OutFile $z; Expand-Archive $z -DestinationPath '.node-tmp' -Force; Move-Item \".node-tmp\$n\" '.node'; Remove-Item '.node-tmp',$z -Recurse -Force"
if not exist ".node\node.exe" (echo Node.js indirilemedi. Internet baglantinizi kontrol edin ya da https://nodejs.org adresinden LTS surumunu kurun. & pause & exit /b 1)

:yerel
set "PATH=%~dp0.node;%PATH%"

:hazir
if not exist "node_modules" (echo Ilk kurulum yapiliyor, birkac dakika surer... & call npm install --no-fund --no-audit || (echo Kurulum basarisiz. & pause & exit /b 1))
if not exist ".env" call npm run anahtar
if not exist "frontend\out\index.html" (echo Arayuz hazirlaniyor... & call npm run build || (pause & exit /b 1))
if not defined PORT set PORT=8765
echo.
echo Senaryo Asistani aciliyor: http://127.0.0.1:%PORT%
echo Bu pencere acik kaldikca uygulama calisir. Kapatmak icin pencereyi kapatin.
echo Giris anahtari: bu klasordeki .env dosyasinda (SENARYO_ERISIM_ANAHTARI).
if not defined SA_TARAYICI_ACMA start "" cmd /c "timeout /t 4 >nul & start http://127.0.0.1:%PORT%"
call npm start
pause
