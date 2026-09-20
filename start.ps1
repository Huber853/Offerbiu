$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw '请安装 Node.js 24 或更新版本。'
}
Write-Host 'Offerbiu 工作台启动中；默认访问 http://127.0.0.1:4174/workspace/'
& node (Join-Path $PSScriptRoot 'server\index.mjs')
