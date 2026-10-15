@echo off
chcp 65001 >nul
rem Bu bilgisayari ekip sunucusu yapar: ayni agdaki herkes tarayicidan baglanir (erisim anahtariyla).
set HOST=0.0.0.0
if not defined PORT set PORT=8000
call "%~dp0baslat.bat"
