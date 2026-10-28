# Reparacion puntual de sqlite3 5.1.7 en la cache npx de n8n 2.44.7.
# No borra datos ni cambia npm/Node ni sus configuraciones globales.
$ErrorActionPreference = 'Stop'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$salidaCache = & $npm config get cache
if ($LASTEXITCODE -ne 0) { throw 'No se pudo localizar la cache de npm.' }
$cacheNpm = ($salidaCache | Select-Object -Last 1).Trim()
$cacheNpx = Join-Path $cacheNpm '_npx'
if (-not (Test-Path -LiteralPath $cacheNpx -PathType Container)) {
    throw 'No se encontro la instalacion npx. Conserva la salida del arranque anterior.'
}

$rutaSqlite = $null
foreach ($carpeta in (Get-ChildItem -LiteralPath $cacheNpx -Directory |
                     Sort-Object LastWriteTime -Descending)) {
    $manifiestoN8n = Join-Path $carpeta.FullName 'node_modules/n8n/package.json'
    $manifiestoSqlite = Join-Path $carpeta.FullName 'node_modules/sqlite3/package.json'
    if (-not (Test-Path -LiteralPath $manifiestoN8n -PathType Leaf) -or
        -not (Test-Path -LiteralPath $manifiestoSqlite -PathType Leaf)) { continue }
    $n8n = Get-Content -Raw -LiteralPath $manifiestoN8n | ConvertFrom-Json
    $sqlite = Get-Content -Raw -LiteralPath $manifiestoSqlite | ConvertFrom-Json
    if ($n8n.name -eq 'n8n' -and $n8n.version -eq '2.44.7' -and
        $sqlite.name -eq 'sqlite3' -and $sqlite.version -eq '5.1.7') {
        if ($sqlite.scripts.install -ne 'prebuild-install -r napi || node-gyp rebuild') {
            throw 'El instalador de SQLite difiere del revisado. No se ejecuto.'
        }
        $rutaSqlite = Split-Path -Parent $manifiestoSqlite
        break
    }
}
if (-not $rutaSqlite) {
    throw 'No se encontro la pareja n8n 2.44.7 / sqlite3 5.1.7 revisada.'
}

# Cargar el modulo no abre una base de datos ni inicia un servicio.
$prueba = 'try { require(process.argv[1]); } catch (error) { process.exitCode = 1; }'
& $node -e $prueba $rutaSqlite
if ($LASTEXITCODE -eq 0) {
    Write-Host 'SQLITE_CARGA_OK: el modulo ya esta disponible. No se modifico.'
    exit 0
}

Write-Host 'Ejecutando solo el instalador revisado de sqlite3 5.1.7.'
Write-Host 'Requiere Internet para descargar su binario; conserva cualquier error.'
# npm run ejecuta este script explicito, sin habilitar scripts de todo el arbol.
& $npm --prefix $rutaSqlite run install
if ($LASTEXITCODE -ne 0) {
    throw 'Fallo el instalador de SQLite. Conserva las lineas anteriores; no instales compiladores aun.'
}
& $node -e 'try { require(process.argv[1]); } catch (error) { console.error(error.message); process.exitCode = 1; }' $rutaSqlite
if ($LASTEXITCODE -ne 0) { throw 'SQLite aun no se puede cargar. Conserva el error anterior.' }
Write-Host 'SQLITE_CARGA_OK. Ahora vuelve a ejecutar n8n/iniciar-local.ps1.'
