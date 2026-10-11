param(
  [Parameter(Position=0)][ValidateSet('help','status','capabilities','call','job')][string]$Action='help',
  [Parameter(Position=1)][string]$Method,
  [string]$ParamsFile,
  [string]$Json,
  [switch]$Stdin,
  [string]$RequestId,
  [ValidateRange(1,3600)][int]$TimeoutSeconds=180
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
function Print-Json($Value) { [Console]::WriteLine(($Value | ConvertTo-Json -Depth 100 -Compress)) }
if ($Action -eq 'help') {
  Print-Json ([ordered]@{
    name='knowledge-cli'; protocolVersion=1
    commands=@('status','capabilities','call <method> -ParamsFile args.json','call <method> -Stdin','job <request-id>')
    examples=@('knowledge-cli.cmd call app.state','knowledge-cli.cmd call library.search -ParamsFile args.json')
    note='Enable Settings > Codex CLI in the desktop app first. JSON files must be UTF-8. Output is JSON. Do not retry timed-out writes with a new request ID; query job first.'
    exitCodes=@{success=0;failed=1;connectionOrArguments=2;pendingOrUnknown=3}
  }); exit 0
}
try {
  $connectionFile = Join-Path $env:LOCALAPPDATA 'com.personal-knowledge-agent.desktop\local-cli\connection.bin'
  if (-not (Test-Path -LiteralPath $connectionFile)) { throw 'CLI is disabled or app is closed. Open the desktop app and enable Settings > Codex CLI.' }
  Add-Type -AssemblyName System.Security
  $encrypted = [IO.File]::ReadAllBytes($connectionFile)
  $clear = [Security.Cryptography.ProtectedData]::Unprotect($encrypted, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $connection = [Text.Encoding]::UTF8.GetString($clear) | ConvertFrom-Json
  if ($connection.protocolVersion -ne 1 -or $connection.port -lt 1 -or $connection.port -gt 65535 -or $connection.token -notmatch '^[a-f0-9]{64}$') { throw 'Invalid CLI connection record. Restart the app and re-enable CLI.' }
  $baseUrl = 'http://127.0.0.1:' + [int]$connection.port
  function Request-Json([string]$Verb, [string]$Route, $Body=$null) {
    $request = [Net.HttpWebRequest]::Create($baseUrl + $Route)
    $request.Method = $Verb; $request.Proxy = $null; $request.AllowAutoRedirect = $false
    $request.Timeout = 15000; $request.ReadWriteTimeout = 15000
    $request.Headers['Authorization'] = 'Bearer ' + $connection.token
    if ($null -ne $Body) {
      $payload = [Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 100 -Compress))
      $request.ContentType = 'application/json; charset=utf-8'; $request.ContentLength = $payload.Length
      $stream = $request.GetRequestStream()
      try { $stream.Write($payload, 0, $payload.Length) } finally { $stream.Dispose() }
    }
    try { $response = $request.GetResponse() }
    catch [Net.WebException] {
      if ($_.Exception.Response) { $response = $_.Exception.Response }
      else { throw 'Local CLI connection failed. The operation outcome may be unknown; inspect the returned request ID before retrying.' }
    }
    try {
      $reader = [IO.StreamReader]::new($response.GetResponseStream(), [Text.Encoding]::UTF8)
      try { $data = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
      if ([int]$response.StatusCode -ge 400) { throw [string]$data.error }
      return $data
    } finally { $response.Dispose() }
  }
  if ($Action -eq 'status' -or $Action -eq 'capabilities') { Print-Json (Request-Json GET ('/v1/' + $Action)); exit 0 }
  if ($Action -eq 'job') {
    if ($Method -notmatch '^[a-fA-F0-9-]{36}$') { throw 'job requires a request UUID.' }
    $job = Request-Json GET ('/v1/jobs/' + $Method)
    Print-Json $job
    if ($job.state -eq 'succeeded') { exit 0 }
    if ($job.state -in @('failed','cancelled')) { exit 1 }
    exit 3
  }
  if (-not $Method) { throw 'call requires a method; use capabilities to list methods and parameters.' }
  $sources = 0
  if ($ParamsFile) { $sources++ }; if ($PSBoundParameters.ContainsKey('Json')) { $sources++ }; if ($Stdin) { $sources++ }
  if ($sources -gt 1) { throw 'Use exactly one of -ParamsFile, -Json or -Stdin.' }
  $inputJson = '{}'
  if ($ParamsFile) { $inputJson = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $ParamsFile), [Text.Encoding]::UTF8) }
  elseif ($Stdin) { $inputJson = [Console]::In.ReadToEnd() }
  elseif ($PSBoundParameters.ContainsKey('Json')) { $inputJson = $Json }
  $arguments = ConvertFrom-Json -InputObject $inputJson
  if ($inputJson.TrimStart()[0] -ne '{') { throw 'Parameters must be a JSON object.' }
  if (-not $RequestId) { $RequestId = [Guid]::NewGuid().ToString() }
  if ($RequestId -notmatch '^[a-fA-F0-9-]{36}$') { throw 'RequestId must be a UUID.' }
  $job = Request-Json POST '/v1/call' @{ id=$RequestId; method=$Method; params=$arguments }
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ($job.state -in @('queued','running') -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
    $job = Request-Json GET ('/v1/jobs/' + $RequestId)
  }
  Print-Json $job
  if ($job.state -eq 'succeeded') { exit 0 }
  if ($job.state -in @('failed','cancelled')) { exit 1 }
  exit 3
} catch {
  Print-Json ([ordered]@{ ok=$false; error=[string]$_.Exception.Message; requestId=$RequestId; hint='If requestId is present, query job before retrying. App restarts clear in-memory job history; inspect actual state in that case.' })
  exit 2
}
