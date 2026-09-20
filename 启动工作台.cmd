@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 24 或更新版本。
  pause
  exit /b 1
)
echo Offerbiu 工作台正在启动。请保持此窗口打开。
echo 主页默认地址：http://127.0.0.1:4174/
echo 工作台默认地址：http://127.0.0.1:4174/workspace/
node server/index.mjs
pause
