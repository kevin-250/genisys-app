@echo off
REM 1) package the app  2) compile the installer with Inno Setup 6 (free: https://jrsoftware.org/isdl.php)
cd /d "%~dp0.."
call npm run package || exit /b 1
set ISCC="%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not exist %ISCC% set ISCC="%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not exist %ISCC% (echo Install Inno Setup 6 first: https://jrsoftware.org/isdl.php & exit /b 1)
%ISCC% installer\genisys.iss && echo. && echo Done: installer\dist\Genisys-Setup.exe
