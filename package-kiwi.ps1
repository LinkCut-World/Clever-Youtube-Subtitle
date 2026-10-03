param(
  [string]$Ref = 'HEAD',
  [string[]]$GitServers = @('https://*/*', 'http://*/*')
)
$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'package-release.ps1') -Ref $Ref -GitServers $GitServers
