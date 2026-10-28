# n8n local para la demostracion. Mantener esta terminal abierta.
# Primera ejecucion: npx descarga la version fijada y sus dependencias.
# Datos/credenciales en .local/n8n/.n8n (excluido de Git).
# No abre firewall, no usa tunel ni configura Supabase automaticamente.
$ErrorActionPreference = 'Stop'
$versionN8n = '2.44.7'
$raizProyecto = Split-Path -Parent $PSScriptRoot
$datosN8n = Join-Path $raizProyecto '.local/n8n'
$directorioRegistros = Join-Path $datosN8n 'logs'

$node = (Get-Command node.exe -ErrorAction Stop).Source
$npx = (Get-Command npx.cmd -ErrorAction Stop).Source
$versionNodeTexto = & $node --version
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar Node.' }
$versionNode = [version]($versionNodeTexto.Trim().TrimStart('v'))
if ($versionNode.Major -ne 24) {
    throw "Este arranque se preparo para Node 24.x. Version encontrada: $versionNodeTexto"
}

New-Item -ItemType Directory -Path $datosN8n -Force | Out-Null
New-Item -ItemType Directory -Path $directorioRegistros -Force | Out-Null
$registroArranque = Join-Path $directorioRegistros ('arranque-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '.log')
$ajustes = @{
    N8N_USER_FOLDER = $datosN8n
    N8N_HOST = 'localhost'
    N8N_LISTEN_ADDRESS = '127.0.0.1'
    N8N_PORT = '5678'
    N8N_PROTOCOL = 'http'
    N8N_EDITOR_BASE_URL = 'http://localhost:5678'
    GENERIC_TIMEZONE = 'America/Bogota'
    TZ = 'America/Bogota'
}
$anteriores = @{}
try {
    foreach ($nombre in $ajustes.Keys) {
        $anteriores[$nombre] = [Environment]::GetEnvironmentVariable($nombre, 'Process')
        [Environment]::SetEnvironmentVariable($nombre, $ajustes[$nombre], 'Process')
    }
    Write-Host "Iniciando n8n $versionN8n con Node $versionNodeTexto."
    Write-Host 'La primera descarga puede tardar varios minutos. No cierres esta terminal.'
    Write-Host 'Cuando n8n anuncie que esta listo, abre http://localhost:5678'
    Write-Host 'Ctrl+C para detener. Los datos locales se conservan.'
    Write-Host "Registro de salida: $registroArranque"
    $preferenciaErrores = $ErrorActionPreference
    try {
        # PowerShell 5.1 representa stderr nativo como ErrorRecord al redirigir.
        # Con Continue se conserva la salida completa hasta conocer el exit code.
        $ErrorActionPreference = 'Continue'
        & $npx --yes --allow-scripts=sqlite3 --package "n8n@$versionN8n" n8n start 2>&1 |
            ForEach-Object { $_.ToString() } |
            Tee-Object -FilePath $registroArranque
        $codigoSalida = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $preferenciaErrores }
    if ($codigoSalida -ne 0) {
        throw "n8n termino con codigo $codigoSalida. Revisa el error en $registroArranque"
    }
}
finally {
    foreach ($nombre in $anteriores.Keys) {
        [Environment]::SetEnvironmentVariable($nombre, $anteriores[$nombre], 'Process')
    }
}
