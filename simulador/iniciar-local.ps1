param([ValidateRange(1024,65535)][int]$Puerto = 5190)
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$versionTexto = & $node --version
if ($LASTEXITCODE -ne 0 -or $versionTexto -notmatch '^v24\.') {
    throw 'El simulador requiere Node 24.x, igual que el proyecto actual.'
}
& $node (Join-Path $PSScriptRoot 'server.mjs') $Puerto
if ($LASTEXITCODE -ne 0) { throw 'El simulador termino con error. Revisa el mensaje anterior.' }
