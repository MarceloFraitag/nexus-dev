@echo off
setlocal
cd /d "%~dp0frontend"
title NEXUS DEV - FRONTEND

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js nao encontrado. Instale a versao LTS.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo [NEXUS] Instalando dependencias do frontend...
  call npm.cmd install
  if errorlevel 1 (
    echo Falha ao instalar bibliotecas JavaScript.
    pause
    exit /b 1
  )
)

echo.
echo [NEXUS] Abra http://127.0.0.1:5173 no navegador.
echo Mantenha esta janela aberta.
call npm.cmd run dev
pause
