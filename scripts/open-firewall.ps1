# 在 Windows 防火墙中放行 WinNav 端口（便于局域网访问）
param(
  [int]$Port = 8080,
  [string]$RuleName = 'WinNav'
)

$ErrorActionPreference = 'Stop'

if (Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue) {
  Write-Host "防火墙规则 $RuleName 已存在"
  exit 0
}

New-NetFirewallRule -DisplayName $RuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow | Out-Null
Write-Host "已放行 TCP $Port（规则名：$RuleName）"
