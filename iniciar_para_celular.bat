@echo off
title Studio Leticia - Servidor e Link Celular
cls
echo ========================================================
echo   STUDIO LETICIA - INICIANDO LINK PARA CELULAR
echo ========================================================
echo.
echo Iniciando servidor interno...
start "Studio Leticia - Servidor" /min node server.js
timeout /t 2 /nobreak >nul
echo.
echo ========================================================
echo  O LINK ABAIXO SERA GERADO EM ALGUNS SEGUNDOS!
echo  Copie a linha que contem: https://...trycloudflare.com
echo  e envie para o WhatsApp da Leticia.
echo.
echo  (Mantenha esta janela aberta enquanto ela estiver usando!)
echo ========================================================
echo.
.\cloudflared.exe tunnel --url http://localhost:3000
pause
