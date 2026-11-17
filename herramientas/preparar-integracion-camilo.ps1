#requires -Version 5.1
<##
 Crea juan/integracion-camilo desde el commit revisado de Camilo.
 Ejecutar desde la terminal propia de VS Code. No aplica SQL ni inicia servicios.
 Conserva main y juan/simulacion-zonas; no crea commits ni usa force/reset.
 Los cambios pendientes se guardan en un stash, se recuperan en la rama nueva
 y el respaldo se conserva. Este guion queda fuera del stash para seguir disponible.
##>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$raizAgv = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$ramaAgv = 'juan/integracion-camilo'
$baseAgv = '280292a098d700bba27d8dcd44a4195fd5130444'
$juanAgv = 'd0e39c745e7658ab6846f51892530f897f752655'
$rutaGuionAgv = 'herramientas/preparar-integracion-camilo.ps1'
$gitAgv = (Get-Command git.exe -ErrorAction Stop).Source
$stashAgv = $null
$carpetaRespaldoAgv = $null

function Invocar-GitAgv {
    param([Parameter(Mandatory)][string[]]$Argumentos)
    # Git escribe progreso normal a stderr; PowerShell 5.1 no debe tratarlo
    # como una excepcion antes de comprobar el codigo de salida real.
    $preferenciaAgv = $ErrorActionPreference
    $errorTemporalAgv = [IO.Path]::GetTempFileName()
    $ErrorActionPreference = 'Continue'
    try {
        $salidaAgv = @(& $gitAgv @Argumentos 2> $errorTemporalAgv)
        $codigoAgv = $LASTEXITCODE
        $errorGitAgv = [IO.File]::ReadAllText($errorTemporalAgv)
    } finally {
        $ErrorActionPreference = $preferenciaAgv
        Remove-Item -LiteralPath $errorTemporalAgv -Force
    }
    if ($codigoAgv -ne 0) {
        $detalleAgv = ($salidaAgv | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        throw "Git no pudo completar '$($Argumentos[0])' (codigo $codigoAgv).`n$detalleAgv`n$errorGitAgv"
    }
    if ($errorGitAgv.Trim()) { Write-Host ($errorGitAgv.Trim()) }
    $salidaAgv | ForEach-Object { $_.ToString() }
}

Push-Location -LiteralPath $raizAgv
try {
    $repoAgv = (Invocar-GitAgv @('rev-parse', '--show-toplevel')).Trim()
    if ([IO.Path]::GetFullPath($repoAgv) -ne $raizAgv) { throw 'La carpeta del guion no coincide con la raiz del repositorio.' }
    $origenAgv = (Invocar-GitAgv @('remote', 'get-url', 'origin')).Trim()
    if ($origenAgv -notmatch '^(https://github\.com/jabj2103/AgroVigia(?:\.git)?|git@github\.com:jabj2103/AgroVigia\.git)$') {
        throw 'El origin no corresponde al repositorio AgroVigia de jabj2103. No se cambio nada.'
    }
    $ramaInicialAgv = (Invocar-GitAgv @('branch', '--show-current')).Trim()
    if (-not $ramaInicialAgv) { throw 'HEAD esta separado. Cambia primero a tu rama habitual.' }
    foreach ($marcadorAgv in @('MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply')) {
        $rutaEstadoAgv = (Invocar-GitAgv @('rev-parse', '--git-path', $marcadorAgv)).Trim()
        if (Test-Path -LiteralPath $rutaEstadoAgv) { throw 'Hay una operacion Git pendiente. Termina esa operacion antes de crear la rama.' }
    }
    $conflictosAgv = @(Invocar-GitAgv @('diff', '--name-only', '--diff-filter=U'))
    if ($conflictosAgv.Count -gt 0) { throw 'Hay conflictos sin resolver. No se guardaron ni cambiaron archivos.' }

    Write-Host 'Descargando referencias de origin...'
    Invocar-GitAgv @('fetch', 'origin') | ForEach-Object { Write-Host $_ }
    Invocar-GitAgv @('cat-file', '-e', "$baseAgv`^{commit}") | Out-Null
    Invocar-GitAgv @('merge-base', '--is-ancestor', $juanAgv, $baseAgv) | Out-Null

    $localAgv = @(Invocar-GitAgv @('branch', '--list', $ramaAgv))
    if ($localAgv.Count -gt 0) {
        $shaLocalAgv = (Invocar-GitAgv @('rev-parse', "refs/heads/$ramaAgv")).Trim()
        if ($shaLocalAgv -ne $baseAgv) { throw 'La rama de integracion local ya existe con otros commits. Se conserva sin sobrescribirla.' }
    }
    $remotaAgv = @(Invocar-GitAgv @('ls-remote', '--heads', 'origin', "refs/heads/$ramaAgv"))
    if ($remotaAgv.Count -gt 0 -and ($remotaAgv[0] -split '\s+')[0] -ne $baseAgv) {
        throw 'La rama de integracion remota ya existe con otros commits. Se conserva sin sobrescribirla.'
    }

    $pendientesAgv = @(Invocar-GitAgv @('status', '--porcelain=v1', '--untracked-files=all'))
    $guardarAgv = @($pendientesAgv | Where-Object { $_ -ne "?? $rutaGuionAgv" })
    if ($guardarAgv.Count -gt 0) {
        $carpetaRespaldoAgv = Join-Path $raizAgv ('.local/respaldos/integracion-camilo-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
        New-Item -ItemType Directory -Path $carpetaRespaldoAgv -Force | Out-Null
        Write-Host 'Guardando los cambios pendientes antes del cambio de rama...'
        Invocar-GitAgv @('stash', 'push', '--include-untracked', '--message', 'Revision previa a integracion Camilo', '--', '.', ":(exclude)$rutaGuionAgv") | ForEach-Object { Write-Host $_ }
        $stashAgv = (Invocar-GitAgv @('rev-parse', 'refs/stash')).Trim()
        $datosRespaldoAgv = [ordered]@{ rama_original = $ramaInicialAgv; rama_integracion = $ramaAgv; base = $baseAgv; stash = $stashAgv }
        [IO.File]::WriteAllText((Join-Path $carpetaRespaldoAgv 'respaldo.json'), ($datosRespaldoAgv | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    }

    if ($localAgv.Count -gt 0) { Invocar-GitAgv @('switch', $ramaAgv) | ForEach-Object { Write-Host $_ } }
    else { Invocar-GitAgv @('switch', '--no-track', '-c', $ramaAgv, $baseAgv) | ForEach-Object { Write-Host $_ } }
    if ($stashAgv) {
        Write-Host 'Recuperando los cambios en la rama de integracion...'
        Invocar-GitAgv @('stash', 'apply', '--index', $stashAgv) | ForEach-Object { Write-Host $_ }
    }
    $actualAgv = (Invocar-GitAgv @('branch', '--show-current')).Trim()
    $commitAgv = (Invocar-GitAgv @('rev-parse', 'HEAD')).Trim()
    if ($actualAgv -ne $ramaAgv -or $commitAgv -ne $baseAgv) { throw 'La comprobacion de la rama nueva no coincide; no se subio a GitHub.' }
    Write-Host 'Subiendo la rama de integracion a GitHub...'
    Invocar-GitAgv @('push', '--set-upstream', 'origin', $ramaAgv) | ForEach-Object { Write-Host $_ }
    $confirmacionAgv = @(Invocar-GitAgv @('ls-remote', '--heads', 'origin', "refs/heads/$ramaAgv"))
    if ($confirmacionAgv.Count -ne 1 -or ($confirmacionAgv[0] -split '\s+')[0] -ne $baseAgv) { throw 'No se pudo verificar la rama en GitHub. Revisa la salida anterior.' }
    Write-Host "LISTO: $ramaAgv local y remota en 280292a."
    Write-Host 'El informe y los cambios recuperados quedan pendientes de commit en esta rama.'
    if ($stashAgv) { Write-Host "Respaldo conservado: $stashAgv. Datos en $carpetaRespaldoAgv" }
    Invocar-GitAgv @('status', '--short', '--branch') | ForEach-Object { Write-Host $_ }
} catch {
    Write-Host 'El guion se detuvo. No usa reset ni descarta cambios.'
    if ($stashAgv) { Write-Host "Respaldo de los cambios: $stashAgv. No repitas stash apply si ya se recuperaron o hay conflictos." }
    if ($carpetaRespaldoAgv) { Write-Host "Registro del respaldo: $carpetaRespaldoAgv" }
    throw
} finally { Pop-Location }
