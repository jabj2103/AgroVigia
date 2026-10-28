#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Position = 0, Mandatory)]
    [ValidateSet('Preparar', 'Iniciar', 'Escuchar', 'Publicar', 'PrepararFirmware', 'IniciarRed')]
    [string]$Accion,
    [string]$MosquittoDir = (Join-Path $env:USERPROFILE 'Documents/Mosquitto'),
    [string]$DireccionIPv4
)

$ErrorActionPreference = 'Stop'
$raizProyecto = Split-Path $PSScriptRoot -Parent
$privado = Join-Path $raizProyecto '.local/mqtt'
$utf8SinBom = [System.Text.UTF8Encoding]::new($false)
$usuarios = @('nodo_dht22', 'nodo_ldr', 'simulador', 'receptor')

function Escribir-Utf8([string]$Ruta, [string]$Contenido) {
    [System.IO.File]::WriteAllText($Ruta, $Contenido, $utf8SinBom)
}

function Confirmar-Preparacion {
    if (-not (Test-Path -LiteralPath (Join-Path $privado 'passwd'))) {
        throw 'Falta el archivo privado passwd. Revisar la preparacion local.'
    }
    foreach ($usuario in $usuarios) {
        if (-not (Test-Path -LiteralPath (Join-Path $privado "$usuario.conf"))) {
            throw 'Falta preparar las credenciales. Ejecuta primero la accion Preparar.'
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $privado 'passwds-listos'))) {
        throw 'Preparacion incompleta. No se iniciara el broker con credenciales parciales.'
    }
}

$ejecutable = switch ($Accion) {
    'Preparar' { 'mosquitto_passwd.exe' }
    'Iniciar' { 'mosquitto.exe' }
    'Escuchar' { 'mosquitto_sub.exe' }
    'Publicar' { 'mosquitto_pub.exe' }
    'PrepararFirmware' { 'mosquitto.exe' }
    'IniciarRed' { 'mosquitto.exe' }
}
$binario = Join-Path $MosquittoDir $ejecutable
if (-not (Test-Path -LiteralPath $binario)) {
    throw "No se encontro $ejecutable. Indica la carpeta existente con -MosquittoDir."
}

Push-Location $raizProyecto
try {
    switch ($Accion) {
        'Preparar' {
            # El proceso es idempotente: no cambia claves de una preparacion completa.
            if (Test-Path -LiteralPath (Join-Path $privado 'passwds-listos')) {
                Confirmar-Preparacion
                Write-Host 'La preparacion ya existe; se conservaron las credenciales.'
                break
            }
            if ((Test-Path -LiteralPath $privado) -and
                @(Get-ChildItem -LiteralPath $privado -Force).Count -gt 0) {
                throw 'Hay una preparacion parcial. Revisar .local/mqtt antes de continuar; no se sobrescribira.'
            }
            # Evita crear secretos si la exclusion fue retirada o Git no puede verificarla.
            & git check-ignore -q -- '.local/mqtt/passwd'
            if ($LASTEXITCODE -ne 0) {
                throw 'Git no excluye .local/mqtt. Revisar .gitignore antes de crear credenciales.'
            }
            New-Item -ItemType Directory -Path $privado -Force | Out-Null
            $claves = @{}
            $lineasPasswd = @()
            foreach ($usuario in $usuarios) {
                $bytesClave = [byte[]]::new(24)
                $generadorClave = [System.Security.Cryptography.RandomNumberGenerator]::Create()
                try { $generadorClave.GetBytes($bytesClave) }
                finally { $generadorClave.Dispose() }
                $claves[$usuario] = [BitConverter]::ToString($bytesClave).Replace('-', '').ToLowerInvariant()
                $lineasPasswd += "${usuario}:$($claves[$usuario])"
            }
            # -U se aplica UNA vez a un archivo nuevo de texto plano; nunca a uno ya hashado.
            # Las claves no se pasan como argumentos ni se imprimen.
            $temporalPasswd = Join-Path $privado 'passwd.nuevo'
            Escribir-Utf8 $temporalPasswd (($lineasPasswd -join "`n") + "`n")
            & $binario -U $temporalPasswd
            if ($LASTEXITCODE -ne 0) { throw 'No se pudo generar el archivo de claves hashadas.' }
            $hashes = [System.IO.File]::ReadAllLines($temporalPasswd)
            if ($hashes.Length -ne $usuarios.Count) { throw 'Archivo de claves incompleto.' }
            foreach ($linea in $hashes) {
                if ($lineasPasswd -contains $linea) { throw 'Una clave no se convirtio a hash.' }
            }
            Move-Item -LiteralPath $temporalPasswd -Destination (Join-Path $privado 'passwd')
            foreach ($usuario in $usuarios) {
                $opciones = @('-h 127.0.0.1', '-p 18883', '-V mqttv311', '-q 1', "-u $usuario", "-P $($claves[$usuario])")
                Escribir-Utf8 (Join-Path $privado "$usuario.conf") (($opciones -join "`n") + "`n")
            }
            Escribir-Utf8 (Join-Path $privado 'passwds-listos') "Credenciales locales generadas; no compartir.`n"
            $claves.Clear()
            Write-Host 'Preparacion completa. Cuatro usuarios; claves privadas excluidas de Git.'
        }
        'Iniciar' {
            Confirmar-Preparacion
            & $binario -c (Join-Path $PSScriptRoot 'agrovigia.conf') --test-config
            if ($LASTEXITCODE -ne 0) { throw 'La configuracion no paso la comprobacion de Mosquitto.' }
            Write-Host 'Broker de AgroVigia en 127.0.0.1:18883. Deja esta terminal abierta; Ctrl+C para detener.'
            & $binario -c (Join-Path $PSScriptRoot 'agrovigia.conf') -v
            if ($LASTEXITCODE -ne 0) { throw 'El broker termino con error. Revisar el registro anterior; no detener otros brokers.' }
        }
        'PrepararFirmware' {
            Confirmar-Preparacion
            $ipComprobada = $null
            if (-not [System.Net.IPAddress]::TryParse($DireccionIPv4, [ref]$ipComprobada) -or
                $ipComprobada.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
                throw 'Indicar la IPv4 del adaptador Wi-Fi con -DireccionIPv4.'
            }
            $octetosIp = $ipComprobada.GetAddressBytes()
            if (-not ($octetosIp[0] -eq 10 -or
                ($octetosIp[0] -eq 172 -and $octetosIp[1] -ge 16 -and $octetosIp[1] -le 31) -or
                ($octetosIp[0] -eq 192 -and $octetosIp[1] -eq 168))) {
                throw 'Esta preparacion solo admite direcciones IPv4 privadas para la red de prueba.'
            }
            $ipTexto = $ipComprobada.ToString()
            $configRed = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'agrovigia.conf'))
            $configRed = $configRed.Replace('# Primera prueba solo en este computador. No accesible desde el ESP32 aun.', '# Prueba temporal LAN sin TLS; no exponer a Internet.')
            $configRed = $configRed.Replace('listener 18883 127.0.0.1', "listener 18883 127.0.0.1`nlistener 18883 $ipTexto")
            $rutaRed = Join-Path $privado 'agrovigia-lan.conf'
            Escribir-Utf8 $rutaRed $configRed
            & $binario -c $rutaRed --test-config
            if ($LASTEXITCODE -ne 0) { throw 'Configuracion de red no valida.' }

            $rutaHeader = Join-Path $raizProyecto 'firmware/nodo-dht22-mqtt/config_local.h'
            & git check-ignore -q -- $rutaHeader
            if ($LASTEXITCODE -ne 0) { throw 'El header privado no esta excluido de Git.' }
            if (-not (Test-Path -LiteralPath $rutaHeader)) {
                $lineaClave = Get-Content -LiteralPath (Join-Path $privado 'nodo_dht22.conf') |
                    Where-Object { $_.StartsWith('-P ') } | Select-Object -First 1
                if (-not $lineaClave) { throw 'No se encontro la clave del nodo DHT22.' }
                $claveCpp = $lineaClave.Substring(3) | ConvertTo-Json -Compress
                $lineasHeader = @(
                    '#pragma once',
                    '// PRIVADO: completar solo Wi-Fi. No compartir ni subir a Git.',
                    'constexpr char WIFI_SSID[] = "CAMBIAR_SSID";',
                    'constexpr char WIFI_PASSWORD[] = "CAMBIAR_CLAVE_WIFI";',
                    "constexpr char MQTT_HOST[] = `"$ipTexto`";",
                    'constexpr uint16_t MQTT_PORT = 18883;',
                    'constexpr char MQTT_USERNAME[] = "nodo_dht22";',
                    "constexpr char MQTT_PASSWORD[] = $claveCpp;"
                )
                Escribir-Utf8 $rutaHeader (($lineasHeader -join "`n") + "`n")
                Write-Host 'config_local.h creado. Completar WIFI_SSID y WIFI_PASSWORD en Arduino IDE.'
            } else {
                Write-Host 'config_local.h ya existe y se conservo. Revisar MQTT_HOST si cambio la IP.'
            }
            Write-Host "Configuracion LAN preparada para $ipTexto`:18883; todavia no se inicia ni cambia el firewall."
        }
        'IniciarRed' {
            Confirmar-Preparacion
            $rutaRed = Join-Path $privado 'agrovigia-lan.conf'
            if (-not (Test-Path -LiteralPath $rutaRed)) { throw 'Ejecutar PrepararFirmware con la IPv4 Wi-Fi antes de IniciarRed.' }
            & $binario -c $rutaRed --test-config
            if ($LASTEXITCODE -ne 0) { throw 'La configuracion LAN no paso la comprobacion.' }
            Write-Host 'Broker LAN de prueba sin TLS. Solo red privada de confianza; no redirigir puertos a Internet.'
            Write-Host 'Cerrar con Ctrl+C el broker anterior antes de iniciar este. No se alteran reglas del firewall.'
            & $binario -c $rutaRed -v
            if ($LASTEXITCODE -ne 0) { throw 'El broker LAN termino con error; revisar IP, puerto y registro.' }
        }
        'Escuchar' {
            Confirmar-Preparacion
            # Los clientes escriben el payload UTF-8. PowerShell 5.1 puede
            # decodificarlo con una pagina OEM y mostrar caracteres como el grado mal.
            [Console]::OutputEncoding = $utf8SinBom
            Write-Host 'Esperando telemetria autorizada. Ctrl+C para terminar.'
            & $binario -o (Join-Path $privado 'receptor.conf') -i agv-monitor-local -t 'agrovigia/v1/+/nodos/+/telemetria' -t 'agrovigia/v2/+/nodos/+/telemetria' -v
            if ($LASTEXITCODE -ne 0) { throw 'No se pudo mantener la suscripcion. Comprobar que el broker siga abierto.' }
        }
        'Publicar' {
            Confirmar-Preparacion
            $payload = [ordered]@{
                version = 1
                nodo_codigo = 'agv-dht22-01'
                mensaje_id = [guid]::NewGuid().ToString()
                origen = 'simulado'
                tomada_en = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'")
                mediciones = @(
                    @{ variable_codigo = 'temperatura_aire'; valor = 28.5; unidad = ([string][char]0x00B0 + 'C') }
                    @{ variable_codigo = 'humedad_aire'; valor = 72; unidad = '% HR' }
                )
            }
            $jsonPayload = $payload | ConvertTo-Json -Depth 5 -Compress
            $esquema = Join-Path $raizProyecto 'docs/mqtt/telemetria.schema.json'
            if (Get-Command Test-Json -ErrorAction SilentlyContinue) {
                if (-not (Test-Json -Json $jsonPayload -SchemaFile $esquema)) { throw 'El ejemplo no pasa el esquema.' }
            }
            else {
                # Windows PowerShell 5.1 no incluye Test-Json. Solo comprueba parseo.
                $jsonPayload | ConvertFrom-Json | Out-Null
                Write-Host 'JSON generado; en PowerShell 5.1 no se valida contra el esquema.'
            }
            $archivoPayload = Join-Path $privado ('simulado-' + $payload.mensaje_id + '.json')
            Escribir-Utf8 $archivoPayload $jsonPayload
            & $binario -o (Join-Path $privado 'simulador.conf') -i ('agv-sim-' + $payload.mensaje_id.Substring(0, 8)) -t 'agrovigia/v1/simulado/nodos/agv-dht22-01/telemetria' -f $archivoPayload
            if ($LASTEXITCODE -ne 0) { throw 'Publicacion fallida. No se confirma entrega al receptor.' }
            Write-Host "Ejemplo SIMULADO enviado con QoS 1. ID: $($payload.mensaje_id)"
            Write-Host 'Comprueba su llegada en la terminal Escuchar. Esto no acredita lectura fisica ni guardado en Supabase.'
        }
    }
}
finally {
    Pop-Location
}
