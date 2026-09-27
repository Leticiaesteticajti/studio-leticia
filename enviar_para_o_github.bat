@echo off
chcp 65001 > nul
title Enviar Studio Leticia para o GitHub
cls
echo ========================================================
echo   ENVIANDO ARQUIVOS DO STUDIO LETICIA PARA O GITHUB
echo ========================================================
echo.
echo Conectando ao GitHub...
echo (Se abrir uma janela no navegador, clique em "Sign in" para autorizar)
echo.

git push -u origin main

echo.
if %ERRORLEVEL% EQU 0 (
    echo ========================================================
    echo   [SUCESSO] Todos os arquivos foram enviados com sucesso!
    echo ========================================================
) else (
    echo ========================================================
    echo   [AVISO] Verifique a mensagem acima para detalhes.
    echo ========================================================
)
echo.
pause
