$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$dir = 'c:\Users\Aaron\Downloads\Nueva carpeta (2)\sitio-optimizado-ventas'
$rxCover = [regex]'function coverImgMarkup\(g\)\{const src=gameCardCover\(g\);[\s\S]*?onerror="\$\{err\}">`;\}'
$idx = [IO.File]::ReadAllText((Join-Path $dir 'index.html'))
$newFn = $rxCover.Match($idx).Value
$findFb = 'const fb=g.steamId?"https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"+g.steamId+"/library_600x900_2x.jpg":"";'
$replFb = 'const parts=[];const hero=g.heroImg;if(hero&&hero!==src)parts.push(hero);if(g.steamId){parts.push("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/"+g.steamId+"/library_600x900_2x.jpg");parts.push("https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/"+g.steamId+"/header.jpg");}const fb=parts.filter((u,i,a)=>a.indexOf(u)===i).join("|");'
$newFn = $newFn.Replace($findFb, $replFb)
$rxErr = [regex]'const err=`[^`]+`;'
$replErr = 'const err=`var f=(this.dataset.fb||"").split("|").filter(Boolean),i=+(this.dataset.tried||0);if(i<f.length){this.dataset.tried=i+1;this.src=f[i]}else{this.outerHTML=''<span class=\''cover-fallback-icon\''>${icon}</span>''}`;'
$newFn = $rxErr.Replace($newFn, $replErr, 1)
$newFn = $newFn.Replace('` data-fb="${fb}"`', '` data-fb="${fb.replace(/"/g,"&quot;")}"`')
if ($newFn -notmatch 'dataset\.tried=i\+1') { throw 'coverImgMarkup transform failed' }
foreach ($f in @('catalogo.html', 'index.html', 'preguntas.html')) {
  $p = Join-Path $dir $f
  $t = [IO.File]::ReadAllText($p)
  if (-not $rxCover.IsMatch($t)) { throw "coverImgMarkup not found in $f" }
  $t = $rxCover.Replace($t, $newFn, 1)
  [IO.File]::WriteAllText($p, $t, $utf8NoBom)
  Write-Output "Updated $f"
}
