@echo off
REM BOAT Protocol build script for Windows

echo Building BOAT Protocol Docker image...
docker-compose build

if %ERRORLEVEL% neq 0 (
    echo Error: Docker build failed
    echo Make sure Docker Desktop is running
    exit /b 1
)

echo.
echo Successfully built BOAT Protocol container!
echo.
echo To start the build environment, run:
echo   docker-compose run boat-build
echo.
echo Or to build directly:
echo   docker-compose run boat-build anchor build
echo.
echo To deploy to devnet:
echo   docker-compose run boat-build anchor deploy --provider.cluster devnet
echo.
