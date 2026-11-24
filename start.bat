@echo off
REM Serves the editor on http://localhost:8080 and opens it in your browser.
REM (You can also just double-click index.html - a local server is only needed
REM  if your browser blocks clipboard or API calls from file:// pages.)
cd /d "%~dp0"
start "" http://localhost:8080/
python -m http.server 8080 --bind 127.0.0.1
