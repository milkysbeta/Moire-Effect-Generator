@echo off
echo Starting Moire Effect Generator on http://localhost:8080 ...
start http://localhost:8080
node "%~dp0server.js"
