$out = New-Object System.Collections.Generic.List[string]
$refPath = 'c:\Users\Aaron\Downloads\WEB\sitio-optimizado-ventas\catalogo.html'
$curPath = 'c:\Users\Aaron\Downloads\Nueva carpeta (2)\sitio-optimizado-ventas\catalogo.html'
$out.Add("REF exists: $(Test-Path $refPath)")
$out.Add("CUR exists: $(Test-Path $curPath)")
$ref = Get-Content $refPath -Raw -Encoding UTF8
$cur = Get-Content $curPath -Raw -Encoding UTF8
$out.Add("REF length: $($ref.Length) CUR length: $($cur.Length)")
$rx = [regex]'id:\d+,name:"((?:\\.|[^"\\])*)".*?img:"((?:\\.|[^"\\])*)"(?:,heroImg:"((?:\\.|[^"\\])*)")?'
$names = @('ARC Raiders','Assassin''s Creed Shadows','Battlefield 6','Call of Duty: Black Ops 6','Call of Duty: Black Ops 7','Crimson Desert','Dead by Daylight','Death Stranding 2: On the Beach','Forza Horizon 6','Ghost of Tsushima','God of War Ragnarok','God of War','Hogwarts Legacy','007 First Light')
foreach($file in @('REF','CUR')){
  $c = if($file -eq 'REF'){$ref}else{$cur}
  $out.Add("=== $file ===")
  $count = 0
  foreach($m in $rx.Matches($c)){
    $n = $m.Groups[1].Value -replace '\\"','"'
    if($names -contains $n){
      $count++
      $img = $m.Groups[2].Value
      $hero = if($m.Groups[3].Success){$m.Groups[3].Value}else{'(none)'}
      $out.Add($n)
      $out.Add("  img: $img")
      $out.Add("  hero: $hero")
    }
  }
  if($count -eq 0){ $out.Add('(no matches for requested names)') }
}
$out.Add('')
$out.Add('=== Death Stranding 2 variants (REF) ===')
foreach($m in $rx.Matches($ref)){
  $n = $m.Groups[1].Value -replace '\\"','"'
  if($n -match 'Death Stranding 2'){
    $out.Add($n)
    $out.Add("  img: $($m.Groups[2].Value)")
    $hero = if($m.Groups[3].Success){$m.Groups[3].Value}else{'(none)'}
    $out.Add("  hero: $hero")
  }
}
$out.Add('')
$out.Add('=== Death Stranding 2 variants (CUR) ===')
foreach($m in $rx.Matches($cur)){
  $n = $m.Groups[1].Value -replace '\\"','"'
  if($n -match 'Death Stranding 2'){
    $out.Add($n)
    $out.Add("  img: $($m.Groups[2].Value)")
    $hero = if($m.Groups[3].Success){$m.Groups[3].Value}else{'(none)'}
    $out.Add("  hero: $hero")
  }
}
$imgRx = [regex]'img:"([^"]*)"'
$fakeInImg = 0; $totalImg = 0
foreach($m in $imgRx.Matches($ref)){ $totalImg++; if($m.Groups[1].Value -match 'fakepng'){ $fakeInImg++ } }
$out.Add('')
$out.Add('=== WEB fakepng in img URLs ===')
$out.Add("Count with fakepng: $fakeInImg / total img fields: $totalImg")
$idx = $ref.IndexOf('coverImgMarkup')
if($idx -ge 0){
  $start = [Math]::Max(0, $idx - 50)
  $len = [Math]::Min(500, $ref.Length - $start)
  $snippet = $ref.Substring($start, $len)
  $out.Add('')
  $out.Add('=== WEB coverImgMarkup (first 500 chars from context) ===')
  $out.Add($snippet)
} else {
  $out.Add('')
  $out.Add('=== coverImgMarkup search in WEB folder ===')
  Get-ChildItem 'c:\Users\Aaron\Downloads\WEB\sitio-optimizado-ventas' -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $t = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if($t -and $t.Contains('coverImgMarkup')){ $out.Add($_.FullName) }
  }
}
$reportPath = 'c:\Users\Aaron\Downloads\Nueva carpeta (2)\sitio-optimizado-ventas\_extract_report.txt'
$out | Set-Content $reportPath -Encoding UTF8
Get-Content $reportPath -Raw
