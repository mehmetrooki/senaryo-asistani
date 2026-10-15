@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Ilk kurulum yapiliyor, bu bir kez birkac dakika surer...
  py -3 -m venv .venv 2>nul || python -m venv .venv
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || (echo Kurulum basarisiz. & pause & exit /b 1)
)
".venv\Scripts\python.exe" baslat.py
pause
