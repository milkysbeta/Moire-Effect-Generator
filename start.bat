@echo off
echo Starting Moire Effect Generator on http://localhost:8090 ...
start http://localhost:8090
node "%~dp0server.js"
