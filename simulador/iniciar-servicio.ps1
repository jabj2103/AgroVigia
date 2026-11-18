#requires -Version 5.1
[CmdletBinding()]
param([switch]$UnaVez)
$ErrorActionPreference = 'Stop'
$raizAgv = Split-Path -Parent $PSScriptRoot
$nodeAgv = (Get-Command node.exe -ErrorAction Stop).Source
if ((& $nodeAgv --version) -notmatch '^v24\.') { throw 'El servicio requiere Node 24.x.' }
if (-not (Test-Path -LiteralPath (Join-Path $raizAgv '.local/secretos.env'))) { throw 'Primero ejecuta n8n/configurar-windows.ps1.' }
$argumentosAgv = @((Join-Path $PSScriptRoot 'servicio.mjs'), '--broker', 'mqtt://127.0.0.1:18883')
if ($UnaVez) { $argumentosAgv += '--una-vez' }
Write-Host 'Servicio automatico de datos SIMULADOS. Mantener esta terminal abierta.'
& $nodeAgv @argumentosAgv
if ($LASTEXITCODE -ne 0) { throw 'El servicio termino con error. Revisa el mensaje anterior.' }
