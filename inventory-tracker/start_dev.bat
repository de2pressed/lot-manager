@echo off
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --disable-web-security --user-data-dir="%TEMP%\raptile_chrome" "%~dp0index.html"
