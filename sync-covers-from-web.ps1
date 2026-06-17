# Patches catalogo.html, index.html, preguntas.html — WEB cover CSS, markup, catalog URLs
$ErrorActionPreference = 'Stop'
$SiteDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Files = @('catalogo.html', 'index.html', 'preguntas.html')
$Utf8NoBom = New-Object System.Text.UTF8Encoding $false

$NewCss = ".product-img .cover-img{width:100%;height:100%;object-fit:cover;object-position:center top;transition:transform .45s ease,filter .3s;position:absolute;inset:0}" + [Environment]::NewLine + ".product-card:hover .product-img .cover-img{transform:scale(1.04);filter:brightness(1.08) saturate(1.05)}"
$NewCoverFn = 'function coverImgMarkup(g){const src=gameCardCover(g);const icon=gameIcon(g);if(!src)return `<span class="cover-fallback-icon">${icon}</span>`;const alt=g.name.replace(/"/g,"&quot;");const fb=g.steamId?"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"+g.steamId+"/library_600x900_2x.jpg":"";const err=`if(this.dataset.fb&&!this.dataset.tried){this.dataset.tried=1;this.src=this.dataset.fb}else{this.outerHTML=''<span class=\\''cover-fallback-icon\\''>${icon}</span>''}`;return `<img class="cover-img" src="${src}"${fb?` data-fb="${fb}"`:""} alt="${alt}" loading="lazy" decoding="async" onerror="${err}">`;}'

$AnimatedMap = [ordered]@{
  'ARC Raiders' = @{ img = 'https://cdn2.steamgriddb.com/grid/e515ecc7ae6e2ea5d01e3d4dcee70c88-fakepng.png'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1808500/library_hero_2x.jpg' }
  'Assassin''s Creed Shadows' = @{ img = 'https://cdn2.steamgriddb.com/grid/0d11594096725a315584de6912918368-fakepng.png'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3159330/library_hero_2x.jpg' }
  'Battlefield 6' = @{ img = 'https://cdn2.steamgriddb.com/grid/5b781dde20c274343faa2b4b2b1898fe-fakepng.png'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2807960/library_hero_2x.jpg' }
  'Call of Duty: Black Ops 7' = @{ img = 'https://cdn2.steamgriddb.com/grid/187f7f4d733ce27d747f2f2d217e65e3-fakepng.png'; hero = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3606480/d7041a15f572f7702d5f4bc97e498cd3e1cc62e2/header.jpg?t=1778886426' }
  'Crimson Desert' = @{ img = 'https://cdn2.steamgriddb.com/grid/305d2dc3d75cad9a9b8c7acb7191af62-fakepng.png'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3321460/library_hero_2x.jpg' }
  'Dead by Daylight' = @{ img = 'https://cdn2.steamgriddb.com/grid/ab490cd4697523f4f9aa8a41893073bd-fakepng.png'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/381210/library_hero_2x.jpg' }
  'Death Stranding 2: On the Beach' = @{ img = 'https://cdn2.steamgriddb.com/grid/6bb8fb7cab2948587d7300ce743074d4-fakepng.png'; hero = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3280350/6270c77b0729e2df0a17d660286eeddfd9169386/header.jpg?t=1774022345' }
  'Forza Horizon 6' = @{ img = 'https://cdn2.steamgriddb.com/grid/c7030ec82b86291dbb98e4d382ac8dda-fakepng.png'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2483190/library_hero_2x.jpg' }
  'Ghost of Tsushima' = @{ img = 'https://cdn2.steamgriddb.com/grid/ddfa98ad575446b8d3b38e533f019076-fakepng.png'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/2215430/library_hero_2x.jpg' }
  'God of War' = @{ img = 'https://cdn2.steamgriddb.com/grid/0793520c195b0793d682cbeca803f967-fakepng.png'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1593500/library_hero_2x.jpg' }
  'Hogwarts Legacy' = @{ img = 'https://cdn2.steamgriddb.com/grid/b257b2c770d6926678e40ba7c97d070f-fakepng.png'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/990080/library_hero_2x.jpg' }
  '007 First Light' = @{ img = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3768760/library_600x900_2x.jpg'; hero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/3768760/library_hero_2x.jpg' }
}

function Normalize-GameName([string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name)) { return '' }
  $n = $Name.ToLowerInvariant()
  $n = $n -replace "[\u2018\u2019']", ''
  $n = $n -replace '[^a-z0-9]+', ' '
  return ($n.Trim())
}

function Get-MappedCover([string]$Name) {
  if ($AnimatedMap.Contains($Name)) { return $AnimatedMap[$Name] }
  $norm = Normalize-GameName $Name
  foreach ($key in $AnimatedMap.Keys) {
    $kNorm = Normalize-GameName $key
    if ($norm -eq $kNorm -or ($kNorm.Length -ge 4 -and $norm.Contains($kNorm)) -or ($norm.Length -ge 4 -and $kNorm.Contains($norm))) {
      return $AnimatedMap[$key]
    }
  }
  if ($Name -like '*Ghost of Tsushima*') { return $AnimatedMap['Ghost of Tsushima'] }
  return $null
}

function Test-IsMapped([string]$Name) { return $null -ne (Get-MappedCover $Name) }

function Test-NeedsSteamHd([string]$ImgUrl) {
  if ([string]::IsNullOrWhiteSpace($ImgUrl)) { return $false }
  if ($ImgUrl -match 'cdn2\.steamgriddb\.com/thumb/') { return $true }
  if ($ImgUrl -notmatch 'fakepng' -and $ImgUrl -notmatch 'library_600x900') { return $true }
  return $false
}

function Get-ImgForName([string]$Content, [string]$GameName) {
  $needle = 'name:"' + $GameName + '"'
  $idx = $Content.IndexOf($needle)
  if ($idx -lt 0) { return $null }
  $sub = $Content.Substring($idx, [Math]::Min(8000, $Content.Length - $idx))
  $m = [regex]::Match($sub, 'img:"([^"]+)"')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

function Update-CatalogSection([string]$Content) {
  $marker = 'const catalog = ['
  $idx = $Content.IndexOf($marker)
  if ($idx -lt 0) { return $Content }
  $arrStart = $Content.IndexOf('[', $idx)
  if ($arrStart -lt 0) { return $Content }
  $depth = 0
  $arrEnd = -1
  for ($i = $arrStart; $i -lt $Content.Length; $i++) {
    $ch = $Content[$i]
    if ($ch -eq '[') { $depth++ }
    elseif ($ch -eq ']') {
      $depth--
      if ($depth -eq 0) { $arrEnd = $i; break }
    }
  }
  if ($arrEnd -lt 0) { return $Content }
  $inner = $Content.Substring($arrStart + 1, $arrEnd - $arrStart - 1)
  $blocks = New-Object System.Collections.Generic.List[string]
  $pos = 0
  while ($pos -lt $inner.Length) {
    $start = $inner.IndexOf('{', $pos)
    if ($start -lt 0) { break }
    $d = 0
    $j = $start
    for (; $j -lt $inner.Length; $j++) {
      if ($inner[$j] -eq '{') { $d++ }
      elseif ($inner[$j] -eq '}') {
        $d--
        if ($d -eq 0) { break }
      }
    }
    if ($d -ne 0) { break }
    [void]$blocks.Add($inner.Substring($start, $j - $start + 1))
    $pos = $j + 1
  }
  $newInner = $inner
  foreach ($block in ($blocks | Sort-Object { $_.Length } -Descending)) {
    $nameM = [regex]::Match($block, 'name:"((?:\\.|[^"\\])*)"')
    if (-not $nameM.Success) { continue }
    $name = $nameM.Groups[1].Value
    $steamM = [regex]::Match($block, 'steamId:"(\d+)"')
    $steamId = if ($steamM.Success) { $steamM.Groups[1].Value } else { $null }
    $imgM = [regex]::Match($block, 'img:"((?:\\.|[^"\\])*)"')
    if (-not $imgM.Success) { continue }
    $img = $imgM.Groups[1].Value
    $newBlock = $block
    $mapped = Get-MappedCover $name
    if ($mapped) {
      $newBlock = [regex]::Replace($newBlock, 'img:"((?:\\.|[^"\\])*)"', ('img:"{0}"' -f $mapped.img), 1)
      if ($newBlock -match 'heroImg:"') {
        $newBlock = [regex]::Replace($newBlock, 'heroImg:"((?:\\.|[^"\\])*)"', ('heroImg:"{0}"' -f $mapped.hero), 1)
      }
    }
    elseif ($steamId -and (Test-NeedsSteamHd $img)) {
      $hdImg = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{0}/library_600x900_2x.jpg' -f $steamId
      $hdHero = 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/{0}/library_hero_2x.jpg' -f $steamId
      $newBlock = [regex]::Replace($newBlock, 'img:"((?:\\.|[^"\\])*)"', ('img:"{0}"' -f $hdImg), 1)
      if ($newBlock -match 'heroImg:"') {
        $newBlock = [regex]::Replace($newBlock, 'heroImg:"((?:\\.|[^"\\])*)"', ('heroImg:"{0}"' -f $hdHero), 1)
      }
    }
    if ($newBlock -ne $block) {
      $newInner = $newInner.Replace($block, $newBlock)
    }
  }
  return $Content.Substring(0, $arrStart + 1) + $newInner + $Content.Substring($arrEnd)
}

function Patch-HtmlFile([string]$Path) {
  $content = [System.IO.File]::ReadAllText($Path)
  $cssRx = '\.product-img \.cover-img\{width:100%[^@]*@keyframes coverHeroPan\{0%\{[^}]+\}100%\{[^}]+\}\}'
  if ([regex]::IsMatch($content, $cssRx)) {
    $content = [regex]::Replace($content, $cssRx, $NewCss, 1)
  }
  elseif ($content -notlike '*product-card:hover .product-img .cover-img{transform:scale(1.04)*') { throw "CSS cover block not found in $Path" }
  $fnRx = 'function coverImgMarkup\(g\)\{const src=gameCardCover\(g\);const hero=gameHeroCover\(g\).*?return out;\}'
  if ([regex]::IsMatch($content, $fnRx)) {
    $content = [regex]::Replace($content, $fnRx, $NewCoverFn, 1)
  }
  elseif ($content -notmatch 'function coverImgMarkup\(g\)\{const src=gameCardCover\(g\);const icon=gameIcon') { throw "coverImgMarkup not found in $Path" }
  $content = Update-CatalogSection $content
  [System.IO.File]::WriteAllText($Path, $content, $Utf8NoBom)
}

Write-Host '=== sync-covers-from-web ==='
foreach ($file in $Files) {
  $full = Join-Path $SiteDir $file
  if (-not (Test-Path -LiteralPath $full)) { throw "Missing file: $full" }
  Patch-HtmlFile $full
  $c = [System.IO.File]::ReadAllText($full)
  $fakepng = ([regex]::Matches($c, 'fakepng')).Count
  $thumb = ([regex]::Matches($c, 'cdn2\.steamgriddb\.com/thumb/')).Count
  $bf = Get-ImgForName $c 'Battlefield 6'
  $i007 = Get-ImgForName $c '007 First Light'
  Write-Host ("File: {0}" -f $file)
  Write-Host ("  fakepng count: {0}" -f $fakepng)
  Write-Host ("  thumb remaining: {0}" -f $thumb)
  Write-Host ("  Battlefield 6 img: {0}" -f $(if ($bf) { $bf } else { '(not in catalog)' }))
  Write-Host ("  007 First Light img: {0}" -f $(if ($i007) { $i007 } else { '(not in catalog)' }))
}
Write-Host 'Done.'
