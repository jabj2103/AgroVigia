# Iniciar web local. Conserva .env.local y no cambia n8n/Mosquitto.
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$versionTexto = & $node --version
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar Node.' }
$version = [version]($versionTexto.Trim().TrimStart('v'))
if ($version.Major -ne 24) { throw 'Esta web se preparo y verifico con Node 24.x.' }
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path -LiteralPath '.env.local')) {
        Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
        Write-Host 'Se creo .env.local. Completa Project URL y Publishable key.'
    }
    if (-not (Test-Path -LiteralPath 'node_modules/vite/package.json')) {
        Write-Host 'Instalando dependencias fijadas por package-lock.json...'
        & $npm ci --ignore-scripts --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias. Conserva el error.' }
    }
    Write-Host 'Web local: http://127.0.0.1:5173. Mantener esta terminal abierta.'
    & $npm run dev
    if ($LASTEXITCODE -ne 0) { throw 'La web termino con error. Conserva las lineas anteriores.' }
}
finally { Pop-Location }
