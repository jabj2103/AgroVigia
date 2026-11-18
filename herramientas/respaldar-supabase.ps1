#requires -Version 5.1
# Respaldo logico del proyecto AgroVigia. Ejecutar desde la terminal de VS Code.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$raizAgv = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$proyectoAgv = 'vzylofqutecvfcbmcjac'
$versionCliAgv = '3.2.0'
$urlAgv = $null
$claveAgv = $null
$carpetaAgv = $null

function Invocar-ExportacionAgv {
    param([string]$Archivo, [string[]]$Opciones = @())
    Write-Host "Exportando $Archivo..."
    $rutaAgv = Join-Path $carpetaAgv $Archivo
    # Invocar con Node evita que cmd.exe expanda los caracteres escapados del URI.
    $preferenciaAgv = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $nodeAgv $entradaCliAgv db dump "--remote=$urlAgv" --file $rutaAgv @Opciones 2>&1 | Out-Null
        $resultadoAgv = $LASTEXITCODE
    } finally { $ErrorActionPreference = $preferenciaAgv }
    if ($resultadoAgv -ne 0 -or -not (Test-Path -LiteralPath $rutaAgv -PathType Leaf)) {
        throw "No se pudo exportar $Archivo (codigo $resultadoAgv). Comprueba Docker, el Host del Session pooler y la contrasena."
    }
}

function Contar-CopiaAgv {
    param([string]$Tabla)
    $expresionAgv = '(?ms)^COPY ' + $Tabla + ' \(.*?\) FROM stdin;\r?\n(?<filas>.*?)^\\\.\r?$'
    $seccionAgv = [regex]::Match($datosAgv, $expresionAgv)
    if (-not $seccionAgv.Success) { throw "Falta la seccion COPY de $Tabla en el respaldo." }
    return [regex]::Matches($seccionAgv.Groups['filas'].Value, '\n').Count
}

Push-Location -LiteralPath $raizAgv
try {
    & git.exe check-ignore -q -- '.local/respaldos/supabase/data.sql'
    if ($LASTEXITCODE -ne 0) { throw 'La ruta de respaldo debe estar excluida de Git.' }
    & docker.exe info --format '{{.ServerVersion}}' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Abre Docker Desktop y espera a que arranque antes de ejecutar el respaldo.' }
    $nodeAgv = (Get-Command node.exe -ErrorAction Stop).Source
    $npxAgv = (Get-Command npx.cmd -ErrorAction Stop).Source
    $shimAgv = @(& $npxAgv --yes "--package=supabase@$versionCliAgv" -- where.exe supabase) |
        Where-Object { $_ -like '*\node_modules\.bin\supabase.cmd' } | Select-Object -First 1
    if ($LASTEXITCODE -ne 0 -or -not $shimAgv) { throw "No se pudo preparar Supabase CLI $versionCliAgv." }
    $modulosAgv = Split-Path -Parent (Split-Path -Parent $shimAgv)
    $paqueteAgv = Join-Path $modulosAgv 'supabase'
    $metaAgv = Get-Content -LiteralPath (Join-Path $paqueteAgv 'package.json') -Raw | ConvertFrom-Json
    if ($metaAgv.version -ne $versionCliAgv) { throw 'No coincide la version de Supabase CLI.' }
    $entradaCliAgv = Join-Path $paqueteAgv $metaAgv.bin.supabase

    $hostAgv = (Read-Host 'Supabase > Connect > Session pooler: pega solo el valor Host').Trim()
    if ($hostAgv -notmatch '^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$') { throw 'El Host del Session pooler no tiene el formato esperado.' }
    $claveAgv = Read-Host 'Contrasena de la base de datos de AgroVigia' -AsSecureString
    if ($claveAgv.Length -eq 0) { throw 'La contrasena de la base de datos esta vacia.' }
    $claveCodificadaAgv = [Uri]::EscapeDataString(([Net.NetworkCredential]::new('', $claveAgv)).Password)
    $urlAgv = 'postgresql://postgres.{0}:{1}@{2}:5432/postgres?sslmode=require' -f $proyectoAgv, $claveCodificadaAgv, $hostAgv

    $carpetaAgv = Join-Path $raizAgv ('.local/respaldos/supabase-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Path $carpetaAgv | Out-Null
    Invocar-ExportacionAgv 'roles.sql' @('--role-only')
    Invocar-ExportacionAgv 'schema.sql'
    Invocar-ExportacionAgv 'data.sql' @('--data-only', '--use-copy', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes')

    $esquemaAgv = [IO.File]::ReadAllText((Join-Path $carpetaAgv 'schema.sql'))
    if ($esquemaAgv -notmatch '(?im)^CREATE TABLE (?:IF NOT EXISTS )?"?public"?\."?mediciones"?\s*\(') {
        throw 'El respaldo no contiene el esquema de mediciones esperado.'
    }
    $datosAgv = [IO.File]::ReadAllText((Join-Path $carpetaAgv 'data.sql'))
    $medicionesAgv = Contar-CopiaAgv '"?public"?\."?mediciones"?'
    $cuentasAgv = Contar-CopiaAgv '"?auth"?\."?users"?'
    if ($medicionesAgv -eq 0 -or $cuentasAgv -eq 0) { throw 'El respaldo no contiene las mediciones y cuentas esperadas.' }
    $archivosAgv = foreach ($nombreAgv in @('roles.sql', 'schema.sql', 'data.sql')) {
        $archivoAgv = Get-Item -LiteralPath (Join-Path $carpetaAgv $nombreAgv)
        [ordered]@{ archivo = $nombreAgv; bytes = $archivoAgv.Length; sha256 = (Get-FileHash -LiteralPath $archivoAgv.FullName -Algorithm SHA256).Hash }
    }
    $resumenAgv = [ordered]@{ proyecto = $proyectoAgv; fecha_utc = [DateTime]::UtcNow.ToString('o'); mediciones = $medicionesAgv; cuentas = $cuentasAgv; archivos = @($archivosAgv) }
    $resumenAgv | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $carpetaAgv 'resumen.json') -Encoding UTF8
    Write-Host ("RESPALDO LISTO: {0} mediciones, {1} cuentas." -f $medicionesAgv, $cuentasAgv)
    Write-Host $carpetaAgv
} catch {
    if ($carpetaAgv) { Write-Host "Respaldo incompleto en $carpetaAgv" }
    throw
} finally {
    $urlAgv = $null
    $claveCodificadaAgv = $null
    if ($claveAgv) { $claveAgv.Dispose() }
    Pop-Location
}
