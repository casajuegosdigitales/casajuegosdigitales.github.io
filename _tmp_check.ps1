$sid = '3472040'
$p = 'c:\Users\Aaron\Downloads\Nueva carpeta (2)\sitio-optimizado-ventas\index.html'
$txt = Get-Content $p -Raw -Encoding UTF8
$rx1 = [regex]('(steamId:"' + $sid + '"[^}]*?img:")([^"]+)(")')
$rx2 = [regex]('(steamId:"' + $sid + '"[\s\S]*?img:")([^"]+)(")')
Write-Output "rx1 success: $($rx1.IsMatch($txt)) match: $($rx1.Match($txt).Groups[2].Value.Substring(0,[Math]::Min(80,$rx1.Match($txt).Groups[2].Value.Length)))"
Write-Output "rx2 success: $($rx2.IsMatch($txt)) match: $($rx2.Match($txt).Groups[2].Value.Substring(0,[Math]::Min(80,$rx2.Match($txt).Groups[2].Value.Length)))"
