#requires -Version 5.1
[CmdletBinding()]
param(
    [ValidatePattern('^gemini-[a-z0-9.\-]{1,50}$')][string]$Modelo = 'gemini-3.5-flash-lite',
    [switch]$RenovarClaves
)
$ErrorActionPreference = 'Stop'
$raizAgv = Split-Path -Parent $PSScriptRoot
$privadoAgv = Join-Path $raizAgv '.local'
$datosAgv = Join-Path $privadoAgv 'n8n'
$nodeAgv = (Get-Command node.exe -ErrorAction Stop).Source
$npxAgv = (Get-Command npx.cmd -ErrorAction Stop).Source
$salidaAgv = $null
$claveSupabaseAgv = $null
$claveGeminiAgv = $null
$entornoAnteriorAgv = [Environment]::GetEnvironmentVariable('N8N_USER_FOLDER', 'Process')

function Leer-ClaveAgv([string]$Pregunta) {
    $seguraAgv = Read-Host $Pregunta -AsSecureString
    try { return ([Net.NetworkCredential]::new('', $seguraAgv)).Password.Trim() }
    finally { $seguraAgv.Dispose() }
}

function Invocar-N8nAgv([string[]]$Argumentos) {
    $preferenciaAgv = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $mensajeAgv = @(& $npxAgv --yes --allow-scripts=sqlite3 --package 'n8n@2.44.7' n8n @Argumentos 2>&1)
        $codigoAgv = $LASTEXITCODE
    } finally { $ErrorActionPreference = $preferenciaAgv }
    if ($codigoAgv -ne 0) {
        $detalleAgv = ($mensajeAgv | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        foreach ($claveAgv in @($claveSupabaseAgv, $claveGeminiAgv)) {
            if ($claveAgv) { $detalleAgv = $detalleAgv.Replace($claveAgv, '[CLAVE]') }
        }
        Write-Host $detalleAgv
        throw "n8n no pudo completar $($Argumentos[0]) (codigo $codigoAgv)."
    }
}

Push-Location -LiteralPath $raizAgv
try {
    if ((& $nodeAgv --version) -notmatch '^v24\.') { throw 'La configuracion requiere Node 24.x.' }
    $clienteAgv = [Net.Sockets.TcpClient]::new()
    try { $abiertoAgv = $clienteAgv.ConnectAsync('127.0.0.1',5678).Wait(500) -and $clienteAgv.Connected }
    catch { $abiertoAgv = $false }
    finally { $clienteAgv.Dispose() }
    if ($abiertoAgv) { throw 'Deten n8n con Ctrl+C en su terminal antes de configurar los flujos.' }
    & git.exe check-ignore -q -- '.local/secretos.env'
    if ($LASTEXITCODE -ne 0) { throw '.local/secretos.env debe estar excluido de Git.' }
    if (-not (Test-Path -LiteralPath (Join-Path $datosAgv '.n8n/database.sqlite'))) { throw 'Falta la instalacion local de n8n con su cuenta creada.' }

    $rutaSecretosAgv = Join-Path $privadoAgv 'secretos.env'
    $secretosAgv = @{}
    if (Test-Path -LiteralPath $rutaSecretosAgv) {
        foreach ($lineaAgv in [IO.File]::ReadAllLines($rutaSecretosAgv)) {
            if ($lineaAgv -match '^([A-Z_0-9]+)=(.*)$') { $secretosAgv[$Matches[1]] = $Matches[2].Trim() }
        }
    }
    $claveSupabaseAgv = $secretosAgv['SUPABASE_SECRET_KEY']
    $claveGeminiAgv = $secretosAgv['GEMINI_API_KEY']
    if ($RenovarClaves -or -not $claveSupabaseAgv) { $claveSupabaseAgv = Leer-ClaveAgv 'Secret key de Supabase (sb_secret_...)' }
    if ($RenovarClaves -or -not $claveGeminiAgv) { $claveGeminiAgv = Leer-ClaveAgv 'API key de Gemini (Google AI Studio)' }
    if ($claveSupabaseAgv -notmatch '^sb_secret_\S+$') { throw 'La clave de Supabase debe empezar por sb_secret_.' }
    if ($claveGeminiAgv.Length -lt 16 -or $claveGeminiAgv -match '\s') { throw 'La clave de Gemini esta vacia o contiene espacios.' }
    $secretosAgv['SUPABASE_URL'] = 'https://vzylofqutecvfcbmcjac.supabase.co'
    $secretosAgv['SUPABASE_SECRET_KEY'] = $claveSupabaseAgv
    $secretosAgv['GEMINI_API_KEY'] = $claveGeminiAgv
    $secretosAgv['GEMINI_MODELO'] = $Modelo
    $contenidoAgv = @($secretosAgv.Keys | Sort-Object | ForEach-Object { $_ + '=' + $secretosAgv[$_] }) -join "`n"
    [IO.File]::WriteAllText($rutaSecretosAgv, $contenidoAgv + "`n", [Text.UTF8Encoding]::new($false))
    Write-Host 'Comprobando acceso a Supabase y disponibilidad del modelo de Gemini...'
    & $nodeAgv (Join-Path $PSScriptRoot 'preparar-windows.cjs') --verificar
    if ($LASTEXITCODE -ne 0) { throw 'La comprobacion fallo. Revisa .local/secretos.env antes de repetir.' }

    $fechaAgv = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $respaldoAgv = Join-Path $privadoAgv ('respaldos/n8n-' + $fechaAgv)
    New-Item -ItemType Directory -Path $respaldoAgv | Out-Null
    foreach ($nombreAgv in @('database.sqlite','database.sqlite-wal','database.sqlite-shm','config')) {
        $origenAgv = Join-Path $datosAgv ('.n8n/' + $nombreAgv)
        if (Test-Path -LiteralPath $origenAgv) { Copy-Item -LiteralPath $origenAgv -Destination $respaldoAgv }
    }
    Write-Host "Respaldo de n8n creado en $respaldoAgv"
    $carpetaClaveAgv = Join-Path $privadoAgv 'ingesta-http'
    New-Item -ItemType Directory -Path $carpetaClaveAgv -Force | Out-Null
    $rutaClaveAgv = Join-Path $carpetaClaveAgv 'clave'
    if (-not (Test-Path -LiteralPath $rutaClaveAgv)) {
        $bytesAgv = New-Object byte[] 32
        $generadorAgv = [Security.Cryptography.RandomNumberGenerator]::Create()
        try { $generadorAgv.GetBytes($bytesAgv) } finally { $generadorAgv.Dispose() }
        [IO.File]::WriteAllText($rutaClaveAgv, [Convert]::ToBase64String($bytesAgv), [Text.UTF8Encoding]::new($false))
    }
    $salidaAgv = Join-Path $privadoAgv ('n8n/importacion-' + $fechaAgv)
    & $nodeAgv (Join-Path $PSScriptRoot 'preparar-windows.cjs') $salidaAgv
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar los flujos para importar.' }
    $resumenAgv = Get-Content -LiteralPath (Join-Path $salidaAgv 'resumen.json') -Raw | ConvertFrom-Json
    [Environment]::SetEnvironmentVariable('N8N_USER_FOLDER', $datosAgv, 'Process')
    Write-Host 'Importando credenciales cifradas en n8n...'
    Invocar-N8nAgv @('import:credentials', '--input', (Join-Path $salidaAgv 'credenciales.json'), '--projectId', $resumenAgv.proyecto)
    foreach ($flujoAgv in $resumenAgv.flujos) {
        Write-Host "Actualizando $($flujoAgv.archivo)..."
        Invocar-N8nAgv @('import:workflow', '--input', (Join-Path $salidaAgv $flujoAgv.archivo), '--projectId', $resumenAgv.proyecto)
        Invocar-N8nAgv @('publish:workflow', '--id', $flujoAgv.id)
    }
    Write-Host 'CONFIGURACION LISTA: 03e, 03f, 03g, 03h y 03i publicados.'
    Write-Host 'Arranca Mosquitto, n8n y el servicio automatico en sus terminales.'
} finally {
    if ($salidaAgv) {
        $rutaCredencialAgv = Join-Path $salidaAgv 'credenciales.json'
        if (Test-Path -LiteralPath $rutaCredencialAgv) { Remove-Item -LiteralPath $rutaCredencialAgv -Force }
    }
    [Environment]::SetEnvironmentVariable('N8N_USER_FOLDER', $entornoAnteriorAgv, 'Process')
    $claveSupabaseAgv = $null
    $claveGeminiAgv = $null
    Pop-Location
}
