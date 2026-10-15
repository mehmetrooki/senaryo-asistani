@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Bu bilgisayari ekip sunucusu yapar: ayni agdaki herkes tarayicidan baglanir.
if not exist ".venv\Scripts\python.exe" (
  echo Ilk kurulum yapiliyor, bu bir kez birkac dakika surer...
  py -3 -m venv .venv 2>nul || python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || (echo Kurulum basarisiz. & pause & exit /b 1)
)
if exist "ekip_sifresi.txt" goto calistir
set /p YENI=Ekip sifresi belirleyin (ekip arkadaslariniza bunu vereceksiniz): 
>"ekip_sifresi.txt" echo %YENI%
:calistir
set /p SENARYO_TAKIM_SIFRESI=<"ekip_sifresi.txt"
if not defined PORT set PORT=8000
".venv\Scripts\python.exe" sunucu.py
pause
