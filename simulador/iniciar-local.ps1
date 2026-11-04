param([ValidateRange(1024,65535)][int]$Puerto = 5190, [switch]$ConMqtt)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$versionTexto = & $node --version
if ($LASTEXITCODE -ne 0 -or $versionTexto -notmatch '^v24\.') {
    throw 'El simulador requiere Node 24.x, igual que el proyecto actual.'
}
$argumentosSimulador = @((Join-Path $PSScriptRoot 'server.mjs'), [string]$Puerto)
if ($ConMqtt) { $argumentosSimulador += '--mqtt' }
& $node @argumentosSimulador
if ($LASTEXITCODE -ne 0) { throw 'El simulador termino con error. Revisa el mensaje anterior.' }
