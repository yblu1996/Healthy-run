@echo off
chcp 65001 >nul
title 跑悟诊断服务重启
echo =========================================
echo 重启跑悟诊断服务 (api/index.js, 端口 3000)
echo =========================================

:: 1) 先结束占用 3000 端口的旧进程（避免双开报"端口被占用"导致新实例起不来）
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
  echo 结束旧进程 PID %%p
  taskkill /PID %%p /F >nul 2>&1
  set FOUND=1
)
if %FOUND%==0 echo 没有发现正在运行的旧进程
timeout /t 2 /nobreak >nul

:: 2) 启动新进程（隐藏窗口，日志写在 server.log / server.err.log）
powershell -NoProfile -Command "Start-Process -WindowStyle Hidden node -ArgumentList 'api/index.js' -WorkingDirectory '%~dp0' -RedirectStandardOutput '%~dp0server.log' -RedirectStandardError '%~dp0server.err.log'"

:: 3) 健康检查：输出 startedAt 与版本号，确认跑的是新进程
timeout /t 3 /nobreak >nul
curl -s --noproxy "*" --max-time 5 http://127.0.0.1:3000/api/health
echo.
echo =========================================
echo 重启完成。若上面没有 JSON 输出，请查看 server.err.log
echo =========================================
pause
