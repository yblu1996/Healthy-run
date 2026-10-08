@echo off
echo =========================================
echo Starting Dify (WSL + Docker)...
echo =========================================

:: WSL sometimes hangs (especially with proxy software running), reset it first
wsl --shutdown
echo WSL reset, waiting 8 seconds...
timeout /t 8 /nobreak >nul

:: Start docker service inside WSL Ubuntu
wsl -d Ubuntu -u root service docker start
echo Waiting for docker service (10s)...
timeout /t 10 /nobreak >nul

:: Start Dify containers (installed at /home/yblu1996/dify)
wsl -d Ubuntu -u root bash -c "cd /home/yblu1996/dify/docker && docker compose up -d"

echo =========================================
echo Waiting for Dify to be ready (up to 3 min)...
echo =========================================
set /a i=0
:waitloop
set /a i+=1
if %i% GTR 36 goto timeout_fail
timeout /t 5 /nobreak >nul
curl -s --noproxy "*" -o nul -w "%%{http_code}" --max-time 5 http://localhost:8180/apps | findstr "200" >nul
if %errorlevel%==0 goto ready
echo Probe %i%: not ready yet...
goto waitloop

:ready
echo =========================================
echo Dify is READY! Open http://localhost:8180/apps
echo =========================================
pause
exit /b 0

:timeout_fail
echo =========================================
echo Timed out. Possible causes:
echo  1. Proxy software (Clash/v2ray) interferes with WSL port forwarding - disable system proxy/TUN and retry
echo  2. Low memory froze WSL - close some programs and retry
echo =========================================
pause
exit /b 1
