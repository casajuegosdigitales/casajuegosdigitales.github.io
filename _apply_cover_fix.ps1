$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false

$steamImg = @{
  '3472040' = 'https://cdn2.steamgriddb.com/grid/f18403b352e777fe53f70caec9993a88.png'
  '3357650' = 'https://cdn2.steamgriddb.com/grid/2c655140a81f8a27d57576e3bf76fb90.png'
  '2353060' = 'https://cdn2.steamgriddb.com/grid/65879e2839b4c288cb517596424968db.png'
  '2215200' = 'https://cdn2.steamgriddb.com/grid/e154fe98c470195b99092d884dcf71f5.jpg'
  '3717070' = 'https://cdn2.steamgriddb.com/grid/1fd4a42f792db220caddf9f1113c6d3e.png'
  '3764200' = 'https://cdn2.steamgriddb.com/thumb/956adefb0eb473d0cd054107659ab6fd.jpg'
  '3768760' = 'https://cdn2.steamgriddb.com/thumb/9cd0f2a7c17876d6721916f09bce496c.jpg'
  '3059520' = 'https://cdn2.steamgriddb.com/grid/fb9d97ffedbaa16cae0906034a254afd.png'
  '3405690' = 'https://cdn2.steamgriddb.com/thumb/f781bbe464dbc0fae27290d123f1170a.jpg'
}

$overrideKeys = @{
  '3472040' = 'nba 2k26'
  '3357650' = 'pragmata'
  '2353060' = 'invincible vs'
  '2215200' = 'lego batman legacy of the dark knight'
  '3717070' = 'wwe 2k26'
  '3764200' = 'resident evil requiem'
  '3768760' = '007 first light'
  '3059520' = 'f1 25'
  '3405690' = 'ea sports fc 26'
}

$oldCover = 'function coverImgMarkup(g){const src=gameCardCover(g);const icon=gameIcon(g);if(!src)return `<span class="cover-fallback-icon">${icon}</span>`;const alt=g.name.replace(/"/g,"&quot;");const fb=g.steamId?"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"+g.steamId+"/library_600x900_2x.jpg":"";const err=`if(this.dataset.fb&&!this.dataset.tried){this.dataset.tried=1;this.src=this.dataset.fb}else{this.outerHTML=''<span class=\\''cover-fallback-icon\\''>${icon}</span>''}`;return `<img class="cover-img" src="${src}"${fb?` data-fb="${fb}"`:""} alt="${alt}" loading="lazy" decoding="async" onerror="${err}">`;}'

$newCover = 'function coverImgMarkup(g){const src=gameCardCover(g);const icon=gameIcon(g);if(!src)return `<span class="cover-fallback-icon">${icon}</span>`;const alt=g.name.replace(/"/g,"&quot;");const parts=[];const hero=g.heroImg;if(hero&&hero!==src)parts.push(hero);if(g.steamId){parts.push("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"+g.steamId+"/library_600x900_2x.jpg");parts.push("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/"+g.steamId+"/header.jpg");}const fb=parts.filter((u,i,a)=>a.indexOf(u)===i).join("|");const err=`var f=(this.dataset.fb||"").split("|").filter(Boolean),i=+(this.dataset.tried||0);if(i<f.length){this.dataset.tried=i+1;this.src=f[i]}else{this.outerHTML=''<span class=\\''cover-fallback-icon\\''>${icon}</span>''}`;return `<img class="cover-img" src="${src}"${fb?` data-fb="${fb.replace(/"/g,"&quot;")}"`:""} alt="${alt}" loading="lazy" decoding="async" onerror="${err}">`;}'

$dir = 'c:\Users\Aaron\Downloads\Nueva carpeta (2)\sitio-optimizado-ventas'
$htmlFiles = @('catalogo.html','index.html','preguntas.html')

foreach ($f in $htmlFiles) {
  $p = Join-Path $dir $f
  $txt = [IO.File]::ReadAllText($p)
  $replCount = 0
  foreach ($kv in $steamImg.GetEnumerator()) {
    $sid = $kv.Key
    $newUrl = $kv.Value
    $rx = [regex]('(steamId:"' + [regex]::Escape($sid) + '"[\s\S]*?img:")([^"]+)(")')
    $newTxt = $rx.Replace($txt, { param($m) $script:replCount++; return $m.Groups[1].Value + $newUrl + $m.Groups[3].Value })
    $txt = $newTxt
  }
  if (-not $txt.Contains($newCover.Substring(0,40))) {
    if (-not $txt.Contains($oldCover.Substring(0,80))) { throw "coverImgMarkup not found in $f" }
    $txt = $txt.Replace($oldCover, $newCover)
  }
  [IO.File]::WriteAllText($p, $txt, $utf8NoBom)
  Write-Output "$f img replacements: $replCount coverImgMarkup: updated"
}

$jsonPath = 'c:\Users\Aaron\Downloads\Nueva carpeta (2)\grid-overrides.json'
$json = Get-Content $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
$jsonObj = @{}
$json.PSObject.Properties | ForEach-Object { $jsonObj[$_.Name] = @{ img = $_.Value.img; heroImg = $_.Value.heroImg } }
foreach ($kv in $overrideKeys.GetEnumerator()) {
  $key = $kv.Value
  $url = $steamImg[$kv.Key]
  if ($jsonObj.ContainsKey($key)) {
    $jsonObj[$key].img = $url
  } else {
    Write-Warning "Missing override key: $key"
  }
}
$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('{')
$keys = $jsonObj.Keys | Sort-Object
for ($i = 0; $i -lt $keys.Count; $i++) {
  $k = $keys[$i]
  $escKey = ($k -replace '\\','\\' -replace '"','\"')
  $escImg = $jsonObj[$k].img -replace '\\','\\' -replace '"','\"'
  $escHero = $jsonObj[$k].heroImg -replace '\\','\\' -replace '"','\"'
  $comma = if ($i -lt $keys.Count - 1) { ',' } else { '' }
  [void]$sb.AppendLine("  `"$escKey`": {")
  [void]$sb.AppendLine("    `"img`": `"$escImg`",")
  [void]$sb.AppendLine("    `"heroImg`": `"$escHero`"")
  [void]$sb.AppendLine("  }$comma")
}
[void]$sb.AppendLine('}')
[IO.File]::WriteAllText($jsonPath, $sb.ToString(), $utf8NoBom)
Write-Output 'grid-overrides.json updated'
