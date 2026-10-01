@echo off
rem PPC 프로토타입 실행 파일 (Windows). 더블클릭하면 필요한 것을 설치하고 브라우저로 앱을 연다.
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title PPC 생산관리

where node >nul 2>nul
if errorlevel 1 goto :no_node

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 goto :old_node

if exist "node_modules\.bin\vite.cmd" goto :run
echo.
echo [1/2] 처음 실행이라 필요한 패키지를 설치합니다. 1~2분 걸립니다...
call npm install --no-audit --no-fund
if errorlevel 1 goto :install_failed

:run
echo.
echo [2/2] PPC를 시작합니다. 잠시 뒤 브라우저가 자동으로 열립니다.
echo       주소: http://localhost:5173
echo       끝내려면 이 창을 닫거나 Ctrl+C 를 누르세요.
echo.
if defined PPC_DRY_RUN goto :dry_run
call npm run dev -- --open
goto :end

:dry_run
echo (PPC_DRY_RUN) 서버를 시작하지 않고 끝냅니다.
goto :eof

:no_node
echo.
echo Node.js가 설치되어 있지 않습니다. PPC를 실행하려면 Node.js 22 이상이 필요합니다.
echo.
where winget >nul 2>nul
if errorlevel 1 goto :manual_install
choice /c YN /m "지금 Node.js LTS를 설치할까요 (winget 사용)"
if errorlevel 2 goto :manual_install
winget install -e --id OpenJS.NodeJS.LTS
echo.
echo 설치가 끝났으면 이 창을 닫고 start-ppc.bat 을 다시 실행하세요.
goto :end

:manual_install
echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 start-ppc.bat 을 다시 실행하세요.
goto :end

:old_node
echo.
echo 설치된 Node.js 버전이 낮습니다 (v%NODE_MAJOR%). 22 이상으로 업데이트한 뒤 다시 실행하세요.
echo   winget upgrade OpenJS.NodeJS.LTS  또는  https://nodejs.org
goto :end

:install_failed
echo.
echo 패키지 설치에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 실행하세요.

:end
echo.
pause
