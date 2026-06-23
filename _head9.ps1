$urls = @(
  'https://cdn2.steamgriddb.com/grid/f18403b352e777fe53f70caec9993a88.png',
  'https://cdn2.steamgriddb.com/grid/2c655140a81f8a27d57576e3bf76fb90.png',
  'https://cdn2.steamgriddb.com/grid/65879e2839b4c288cb517596424968db.png',
  'https://cdn2.steamgriddb.com/grid/e154fe98c470195b99092d884dcf71f5.jpg',
  'https://cdn2.steamgriddb.com/grid/1fd4a42f792db220caddf9f1113c6d3e.png',
  'https://cdn2.steamgriddb.com/thumb/956adefb0eb473d0cd054107659ab6fd.jpg',
  'https://cdn2.steamgriddb.com/thumb/9cd0f2a7c17876d6721916f09bce496c.jpg',
  'https://cdn2.steamgriddb.com/grid/fb9d97ffedbaa16cae0906034a254afd.png',
  'https://cdn2.steamgriddb.com/thumb/f781bbe464dbc0fae27290d123f1170a.jpg'
)
$ok = 0; $fail = 0
foreach ($url in $urls) {
  try {
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = 'HEAD'
    $req.Timeout = 15000
    $req.AllowAutoRedirect = $true
    $req.UserAgent = 'CoverAudit/1.0'
    $resp = $req.GetResponse()
    $code = [int]$resp.StatusCode
    $resp.Close()
    if ($code -ge 200 -and $code -lt 300) { $ok++; Write-Output "OK $code $url" } else { $fail++; Write-Output "FAIL $code $url" }
  } catch {
    $fail++
    $c = ''
    if ($_.Exception.Response) { try { $c = [int]$_.Exception.Response.StatusCode } catch {} }
    Write-Output "FAIL $c $url"
  }
}
Write-Output "SUMMARY OK=$ok FAIL=$fail"
