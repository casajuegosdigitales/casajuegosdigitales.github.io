$ErrorActionPreference = 'Continue'
$curPath = "c:\Users\Aaron\Downloads\Nueva carpeta (2)\sitio-optimizado-ventas\catalogo.html"
$refPath = "c:\Users\Aaron\Downloads\WEB\sitio-optimizado-ventas\catalogo.html"
$outPath = "c:\Users\Aaron\Downloads\Nueva carpeta (2)\sitio-optimizado-ventas\_cover_audit.txt"

function Get-CatalogGames([string]$htmlPath) {
  if (-not (Test-Path $htmlPath)) { return @() }
  $txt = Get-Content $htmlPath -Raw -Encoding UTF8
  $games = [System.Collections.Generic.List[object]]::new()
  $entryRx = [regex]'id:(\d+),name:"((?:\\.|[^"\\])*)"'
  $matches = $entryRx.Matches($txt)
  for ($i = 0; $i -lt $matches.Count; $i++) {
    $m = $matches[$i]
    $start = $m.Index
    if ($i + 1 -lt $matches.Count) { $end = $matches[$i+1].Index } else { $end = $txt.Length }
    $block = $txt.Substring($start, ($end - $start))
    $name = $m.Groups[2].Value -replace '\\"','"' -replace '\\n',"`n"
    $steamId = ''
    $sm = [regex]::Match($block, 'steamId:"((?:\\.|[^"\\])*)"')
    if ($sm.Success) { $steamId = $sm.Groups[1].Value }
    $img = ''
    $im = [regex]::Match($block, '(?<![a-zA-Z])img:"((?:\\.|[^"\\])*)"')
    if ($im.Success) { $img = $im.Groups[1].Value }
    $games.Add([pscustomobject]@{ id = $m.Groups[1].Value; name = $name; steamId = $steamId; img = $img })
  }
  return $games
}

function Test-UrlHead([string]$url, [int]$timeoutSec = 10) {
  if ([string]::IsNullOrWhiteSpace($url)) { return 'EMPTY' }
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = 'HEAD'
    $req.Timeout = $timeoutSec * 1000
    $req.ReadWriteTimeout = $timeoutSec * 1000
    $req.AllowAutoRedirect = $true
    $req.UserAgent = 'CoverAudit/1.0'
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $resp.Close()
    if ($code -ge 200 -and $code -lt 300) { return 'OK' }
    return "FAIL($code)"
  } catch {
    if ($_.Exception.Response) {
      try {
        $code = [int]$_.Exception.Response.StatusCode
        return "FAIL($code)"
      } catch {}
    }
    return 'FAIL'
  }
}

function Get-SteamFallbacks([string]$steamId) {
  if ([string]::IsNullOrWhiteSpace($steamId)) { return @() }
  return @(
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/$steamId/library_600x900_2x.jpg",
    "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/$steamId/library_600x900.jpg",
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/$steamId/header.jpg"
  )
}

$curGames = Get-CatalogGames $curPath
$refList = Get-CatalogGames $refPath
$refByName = @{}
foreach ($g in $refList) { if (-not $refByName.ContainsKey($g.name)) { $refByName[$g.name] = $g } }

$urlCache = @{}
function Invoke-HeadUnique([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return 'EMPTY' }
  if ($urlCache.ContainsKey($url)) { return 'SKIP' }
  $st = Test-UrlHead $url
  $urlCache[$url] = $st
  return $st
}
function Get-CachedStatus([string]$url) {
  if ([string]::IsNullOrWhiteSpace($url)) { return 'EMPTY' }
  if (-not $urlCache.ContainsKey($url)) {
    $urlCache[$url] = Test-UrlHead $url
    return $urlCache[$url]
  }
  return $urlCache[$url]
}

$missingImg = [System.Collections.Generic.List[object]]::new()
$brokenPrimary = [System.Collections.Generic.List[object]]::new()
$totalFail = [System.Collections.Generic.List[object]]::new()

$progress = 0
foreach ($game in $curGames) {
  $progress++
  if ($progress % 50 -eq 0) { Write-Host "Checked $progress / $($curGames.Count)..." }
  $img = $game.img
  if ([string]::IsNullOrWhiteSpace($img)) {
    $missingImg.Add($game)
    continue
  }
  $headTag = Invoke-HeadUnique $img
  $primaryStatus = if ($headTag -eq 'SKIP') { Get-CachedStatus $img } else { $headTag }
  if ($primaryStatus -eq 'OK') { continue }

  $bestFallback = $null
  foreach ($fb in (Get-SteamFallbacks $game.steamId)) {
    $fbTag = Invoke-HeadUnique $fb
    $fbSt = if ($fbTag -eq 'SKIP') { Get-CachedStatus $fb } else { $fbTag }
    if ($fbSt -eq 'OK') { $bestFallback = $fb; break }
  }

  $refNote = ''
  if ($refByName.ContainsKey($game.name)) {
    $refG = $refByName[$game.name]
    if (-not [string]::IsNullOrWhiteSpace($refG.img)) {
      $refTag = Invoke-HeadUnique $refG.img
      $refSt = if ($refTag -eq 'SKIP') { Get-CachedStatus $refG.img } else { $refTag }
      if ($refSt -eq 'OK') { $refNote = $refG.img }
    }
  }

  if ($bestFallback) {
    $brokenPrimary.Add([pscustomobject]@{
      name = $game.name; steamId = $game.steamId; img = $img
      primaryStatus = $primaryStatus; bestFallback = $bestFallback; refImg = $refNote
    })
  } else {
    $totalFail.Add([pscustomobject]@{
      name = $game.name; steamId = $game.steamId; img = $img
      primaryStatus = $primaryStatus; refImg = $refNote
    })
  }
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('=== Game Cover URL Audit ===')
[void]$sb.AppendLine("CUR: $curPath")
[void]$sb.AppendLine("REF: $refPath")
[void]$sb.AppendLine("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
[void]$sb.AppendLine('')
[void]$sb.AppendLine("Total games: $($curGames.Count)")
[void]$sb.AppendLine("Games with missing img: $($missingImg.Count)")
[void]$sb.AppendLine("Games with broken primary img (fallback OK): $($brokenPrimary.Count)")
[void]$sb.AppendLine("Games where primary + all Steam fallbacks fail: $($totalFail.Count)")
[void]$sb.AppendLine("Unique img URLs HEAD-checked: $($urlCache.Count)")
[void]$sb.AppendLine('')

if ($missingImg.Count -gt 0) {
  [void]$sb.AppendLine('--- Missing img ---')
  foreach ($g in $missingImg) { [void]$sb.AppendLine("- $($g.name) (steamId: $($g.steamId))") }
  [void]$sb.AppendLine('')
}

if ($brokenPrimary.Count -gt 0) {
  [void]$sb.AppendLine('--- Broken primary img (name | current img | best fallback | REF img if CUR fails but REF OK) ---')
  foreach ($g in $brokenPrimary) {
    [void]$sb.AppendLine("- $($g.name) [$($g.primaryStatus)]")
    [void]$sb.AppendLine("    current: $($g.img)")
    [void]$sb.AppendLine("    fallback: $($g.bestFallback)")
    if ($g.refImg) { [void]$sb.AppendLine("    REF working img: $($g.refImg)") }
  }
  [void]$sb.AppendLine('')
}

if ($totalFail.Count -gt 0) {
  [void]$sb.AppendLine('--- Primary + all Steam fallbacks FAIL ---')
  foreach ($g in $totalFail) {
    [void]$sb.AppendLine("- $($g.name) (steamId: $($g.steamId)) [$($g.primaryStatus)]")
    [void]$sb.AppendLine("    current: $($g.img)")
    if ($g.refImg) { [void]$sb.AppendLine("    REF working img: $($g.refImg)") }
  }
}

$report = $sb.ToString()
Set-Content -Path $outPath -Value $report -Encoding UTF8
Write-Output $report
