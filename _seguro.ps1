# ============================================================
#  Revision de credenciales antes de subir
# ============================================================
#  Lo llama _seguro.bat. Sale con codigo 1 si encuentra algo.
#
#  Se hace en PowerShell y no en el .bat porque las expresiones
#  regulares con comillas dentro de un .bat son un campo minado.
#
#  El reto no es encontrar credenciales: es no gritar cuando no
#  las hay. Una alarma que salta seguido y siempre es falsa se
#  acaba ignorando, y ese dia deja de servir justo cuando
#  importaba.
# ============================================================

$archivos = @()
foreach ($p in @('apps-script\*.gs', 'docs\*.js', 'docs\*.html')) {
    $archivos += Get-ChildItem -Path $p -ErrorAction SilentlyContinue
}
if ($archivos.Count -eq 0) { exit 0 }

# --- Por contexto: el nombre de la variable delata al valor ---
$patrones = @(
    @{ n = 'cookie de sesion';  r = '(PHPSESSID|JSESSIONID|ASP\.NET_SessionId|csrftoken|session_id\s*=\s*\w{8,}|sessionid\s*=\s*\w{8,})' },
    @{ n = 'token Bearer';      r = 'Bearer\s+[A-Za-z0-9\-\._~\+\/]{20,}' },
    @{ n = 'password asignado'; r = '(?i)pass(word|wd)?\s*[:=]\s*["''][^"'']{4,}["'']' },
    @{ n = 'cookie asignada';   r = '(?i)(SITE_COOKIE|cookie)\s*[:=]\s*["''][^"'']{20,}["'']' },
    @{ n = 'llave de API';      r = '(?i)(api[_-]?key|apikey|secret|client[_-]?secret)\s*[:=]\s*["''][^"'']{8,}["'']' }
)

# --- Por forma: no importa como se llame la variable ---
#
# OJO: estos se comparan con -cmatch, que SI distingue mayusculas.
# El -match normal de PowerShell las ignora, y con eso la URL del Web App
# (.../AKfycby85T2KwoDZ...NeYJUH0kAABi...) casaba contra 'eyJ' por culpa
# del 'YJU' de en medio. Alerta falsa en cada commit, sobre la unica linea
# que SIEMPRE va a estar ahi.
$porForma = @(
    @{ n = 'JWT / cookie de sesion'; r = 'eyJ[A-Za-z0-9_\-]{15,}' },
    @{ n = 'llave con prefijo';      r = '(sk|pk|rk|ghp|gho|xox[bap])[_\-](live|test|prod)?[_\-]?[A-Za-z0-9]{12,}' }
)

# La URL del Web App es publica a proposito y vive en docs/config.js.
# No es credencial: sin el password no devuelve un solo dato.
$permitidas = @('script.google.com/macros/')

# Un nombre de constante o de campo no es un secreto. Pero solo se perdona
# si ADEMAS es corto: las llaves de API tambien son minusculas con guiones,
# y esas son largas. 'SITE_PASS' es un nombre; 'sk-live-9f8a7b6c' es fuga.
function EsNombreNoSecreto([string]$valor) {
    if ($valor -eq '')                                               { return $true }
    if ($valor -match 'PON_|EJEMPLO|CAMBIA')                         { return $true }
    if ($valor -match '^\{.*\}$')                                    { return $true }
    if ($valor -cmatch '^[A-Z0-9_]+$'   -and $valor.Length -le 32)   { return $true }
    if ($valor -cmatch '^[a-z0-9_\-]+$' -and $valor.Length -le 16)   { return $true }
    return $false
}

$fuga = 0

foreach ($a in $archivos) {
    $lineas = Get-Content -Path $a.FullName -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt $lineas.Count; $i++) {
        $linea = $lineas[$i]

        # Los comentarios hablan DE las credenciales sin contenerlas.
        if ($linea -match '^\s*(\*|//|#|<!--)') { continue }

        # Lineas explicitamente permitidas
        $saltar = $false
        foreach ($ok in $permitidas) {
            if ($linea -like ('*' + $ok + '*')) { $saltar = $true }
        }
        if ($saltar) { continue }

        $encontrado = ''

        # 1) Por forma. -cmatch, no -match (ver nota arriba).
        foreach ($p in $porForma) {
            if ($linea -cmatch $p.r) { $encontrado = $p.n; break }
        }

        # 2) Por contexto, revisando ademas la forma del valor.
        if ($encontrado -eq '') {
            foreach ($p in $patrones) {
                if ($linea -match $p.r) {
                    $valor = ''
                    $todas = [regex]::Matches($linea, '["'']([^"'']{4,})["'']')
                    if ($todas.Count -gt 0) { $valor = $todas[$todas.Count - 1].Groups[1].Value }
                    if (EsNombreNoSecreto $valor) { continue }
                    $encontrado = $p.n
                    break
                }
            }
        }

        if ($encontrado -ne '') {
            $recorte = $linea.Trim()
            $corte = [Math]::Min(70, $recorte.Length)
            Write-Host ("        ALERTA: " + $encontrado + " en " + $a.Name + " linea " + ($i + 1))
            Write-Host ("                " + $recorte.Substring(0, $corte))
            $fuga = 1
        }
    }
}

exit $fuga
