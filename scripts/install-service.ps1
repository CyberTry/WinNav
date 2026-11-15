# WinNav 安装为 Windows 服务（使用 NSSM）
# 用法：以管理员身份打开 PowerShell，在项目根目录执行
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-service.ps1
param(
  [string]$ServiceName = 'WinNav',
  [int]$Port = 8080,
  [string]$NssmPath = 'nssm'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw '未找到 node.exe，请先安装 Node.js 20+ 并加入 PATH' }

if (-not (Get-Command $NssmPath -ErrorAction SilentlyContinue)) {
  throw '未找到 nssm，请先下载 nssm.exe 并加入 PATH，或用 -NssmPath 指定完整路径'
}

$app = Join-Path $root 'src\server.js'
$dataDir = Join-Path $root 'data'
$logDir = Join-Path $dataDir 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Host "服务 $ServiceName 已存在，先移除旧服务"
  & $NssmPath stop $ServiceName | Out-Null
  & $NssmPath remove $ServiceName confirm | Out-Null
}

Write-Host "安装服务 $ServiceName -> $node $app"
& $NssmPath install $ServiceName $node $app
& $NssmPath set $ServiceName AppDirectory $root
& $NssmPath set $ServiceName AppEnvironmentExtra "PORT=$Port" "DATA_DIR=$dataDir"
& $NssmPath set $ServiceName AppStdout (Join-Path $logDir 'service.out.log')
& $NssmPath set $ServiceName AppStderr (Join-Path $logDir 'service.err.log')
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateBytes 10485760
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppRestartDelay 3000
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath start $ServiceName

Start-Sleep -Seconds 2
Get-Service -Name $ServiceName | Format-Table -AutoSize
Write-Host ""
Write-Host "访问地址： http://127.0.0.1:$Port"
Write-Host "管理台：   http://127.0.0.1:$Port/admin"
Write-Host "默认账号： admin / 123456（首次登录后请立即修改）"
