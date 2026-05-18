@echo off
REM ========================================
REM MPSS Radar Dashboard Launcher
REM ========================================
title MPSS Radar Dashboard

echo.
echo ========================================
echo   MPSS Radar Dashboard
echo   KhahanA Insights
echo ========================================
echo.

cd /d "%~dp0"

REM Kill any existing http-server on port 8080 to prevent EADDRINUSE
echo Checking for existing server on port 8080...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8080 ^| findstr LISTENING') do (
    echo Stopping existing process %%a...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Starting dashboard server on http://localhost:8080
echo.
echo IMPORTANT: Keep this window OPEN while using the dashboard.
echo Press Ctrl+C in this window to stop the server when done.
echo.

REM Start http-server and auto-open browser
npx http-server -p 8080 -o /index.html

REM If npx fails, show a friendly message
if errorlevel 1 (
    echo.
    echo ========================================
    echo   Server failed to start
    echo ========================================
    echo Possible causes:
    echo   - Node.js not installed
    echo   - npm/npx not in PATH
    echo   - Permission issues
    echo.
    pause
)
