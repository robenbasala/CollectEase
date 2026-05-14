@echo off
setlocal

echo ========================================
echo CollectEase Deploy Started
echo ========================================

set PROJECT_ROOT=C:\Sites\CollectEase
set BACKEND_DIR=%PROJECT_ROOT%\backend
set FRONTEND_DIR=%PROJECT_ROOT%\frontend
set BACKEND_PM2_ID=1

echo.
echo [1/6] Going to backend folder...
cd /d "%BACKEND_DIR%"
if errorlevel 1 (
    echo ERROR: Backend folder not found.
    pause
    exit /b 1
)

echo.
echo [2/6] Installing backend packages...
call npm install
if errorlevel 1 (
    echo ERROR: Backend npm install failed.
    pause
    exit /b 1
)

echo.
echo [3/6] Restarting backend with PM2...
call pm2 restart %BACKEND_PM2_ID%
if errorlevel 1 (
    echo PM2 restart by ID failed. Trying restart all...
    call pm2 restart all
)

echo.
echo Saving PM2 process list...
call pm2 save

echo.
echo [4/6] Going to frontend folder...
cd /d "%FRONTEND_DIR%"
if errorlevel 1 (
    echo ERROR: Frontend folder not found.
    pause
    exit /b 1
)

echo.
echo [5/6] Installing frontend packages...
call npm install
if errorlevel 1 (
    echo ERROR: Frontend npm install failed.
    pause
    exit /b 1
)

echo.
echo Building frontend...
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed.
    pause
    exit /b 1
)

echo.
echo Checking web.config copied to dist...
if exist "%FRONTEND_DIR%\dist\web.config" (
    echo web.config found in dist.
) else (
    echo ERROR: web.config was NOT copied to dist.
    echo Make sure it exists here:
    echo %FRONTEND_DIR%\public\web.config
    pause
    exit /b 1
)

echo.
echo [6/6] Restarting IIS...
iisreset
if errorlevel 1 (
    echo ERROR: IIS restart failed. Run this BAT as Administrator.
    pause
    exit /b 1
)

echo.
echo Testing backend local...
curl http://localhost:5001/api/auth/me

echo.
echo Testing public API...
curl https://portal.collectease360.com/api/auth/me

echo.
echo ========================================
echo Deploy Finished
echo ========================================
pause