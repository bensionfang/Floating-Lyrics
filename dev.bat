@echo off
REM Kanaric dev launcher. Comments and cleanup logic live in scripts\dev-cleanup.ps1 --
REM cmd parses batch files with the OEM codepage, so non-ASCII comments here break parsing.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\dev-cleanup.ps1"
cd /d "%~dp0web-app"
call npm run app
