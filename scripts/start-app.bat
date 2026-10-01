@echo off
setlocal
echo Uruchamianie aplikacji...
echo Adres: http://127.0.0.1:3000
echo Log: "%TEMP%\jewelry-workshop-demo-dev.log"
cd /d "%~dp0.."
if errorlevel 1 goto folder_error
where node >nul 2>&1
if errorlevel 1 goto node_error
node "%~dp0start-app.cjs"
if errorlevel 1 goto launcher_error
exit /b 0
:folder_error
echo BLAD: Nie mozna otworzyc katalogu projektu.
goto launcher_error
:node_error
echo BLAD: Nie znaleziono Node.js. Zainstaluj Node.js 22.18 lub nowszy.
:launcher_error
echo Uruchomienie nie powiodlo sie. Adres pozostaje http://127.0.0.1:3000
echo Log: "%TEMP%\jewelry-workshop-demo-dev.log". Przed startem Node log moze nie istniec.
pause
exit /b 1
