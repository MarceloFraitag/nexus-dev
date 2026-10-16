@echo off
chcp 65001 >nul
title NEXUS DEV - VERIFICACAO

echo =====================================
echo        NEXUS DEV - V0.5

echo =====================================
py --version
git --version
node --version
call npm.cmd --version
ollama --version
ollama list

echo.
echo Se o modelo nao aparecer na lista:
echo ollama pull qwen2.5-coder:7b
echo ollama pull qwen2.5-coder:1.5b
pause
