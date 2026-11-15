# 卸载 WinNav Windows 服务
param(
  [string]$ServiceName = 'WinNav',
  [string]$NssmPath = 'nssm'
)

$ErrorActionPreference = 'Stop'

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $service) {
  Write-Host "服务 $ServiceName 不存在，无需卸载"
  exit 0
}

Write-Host "停止并移除服务 $ServiceName"
& $NssmPath stop $ServiceName | Out-Null
& $NssmPath remove $ServiceName confirm | Out-Null
Write-Host '已卸载。数据仍保留在 data/ 目录中，如需彻底清理请手动删除。'
