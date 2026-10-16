@echo off
setlocal
cd /d "%~dp0backend"
title NEXUS DEV - BACKEND

where py >nul 2>&1
if errorlevel 1 (
  echo Python Launcher nao encontrado. Instale o Python e marque a opcao PATH.
  pause
  exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [NEXUS] Preparando ambiente Python...
  py -m venv .venv
  if errorlevel 1 (
    echo Falha ao criar ambiente virtual.
    pause
    exit /b 1
  )
)

call .venv\Scripts\activate.bat
python -c "import fastapi, uvicorn, httpx, multipart" >nul 2>&1
if errorlevel 1 (
  echo [NEXUS] Instalando dependencias do backend...
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Falha ao instalar bibliotecas Python. Confira a conexao.
    pause
    exit /b 1
  )
)

echo.
echo [NEXUS] API: http://127.0.0.1:8000/docs
echo Mantenha esta janela aberta.
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
