param([string]$TypeWordsPath, [switch]$NoApp)
$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$appPath = Join-Path $env:LOCALAPPDATA '个人知识库 Agent\knowledge-agent-desktop.exe'
if (-not $NoApp -and -not (Test-Path -LiteralPath $appPath)) {
  throw 'Install the official Knowledge Agent Windows release first.'
}

function Test-TypeWords {
  try { $response = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5567/words' -TimeoutSec 2 } catch { return $false }
  if ($response.Content -notmatch 'Type\s?Words') { throw 'Port 5567 is occupied by another application.' }
  return $true
}

if (-not (Test-TypeWords)) {
  if (-not $TypeWordsPath) {
    $candidates = @((Join-Path $repoPath 'third_party\typewords'), (Join-Path (Split-Path $repoPath -Parent) 'TypeWords-3.0.7'))
    $TypeWordsPath = $candidates | Where-Object { Test-Path -LiteralPath (Join-Path $_ '.output\server\index.mjs') } | Select-Object -First 1
  }
  if (-not $TypeWordsPath -or -not (Test-Path -LiteralPath (Join-Path $TypeWordsPath '.output\server\index.mjs'))) {
    throw 'TypeWords build not found. Supply -TypeWordsPath with the installed TypeWords folder.'
  }
  $nodePath = (Get-Command node -ErrorAction Stop).Source
  $logPath = Join-Path $repoPath '.local-plugin-logs'
  New-Item -ItemType Directory -Force -Path $logPath | Out-Null
  $previousHost = $env:NITRO_HOST
  $previousPort = $env:NITRO_PORT
  try {
    $env:NITRO_HOST = '127.0.0.1'
    $env:NITRO_PORT = '5567'
    $service = Start-Process -FilePath $nodePath -ArgumentList '.output/server/index.mjs' -WorkingDirectory $TypeWordsPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'typewords-installed.log') -RedirectStandardError (Join-Path $logPath 'typewords-installed-error.log') -PassThru
  } finally {
    $env:NITRO_HOST = $previousHost
    $env:NITRO_PORT = $previousPort
  }
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-TypeWords) { $ready = $true; break }
    $service.Refresh()
    if ($service.HasExited) { throw "TypeWords stopped. Check logs: $logPath" }
    Start-Sleep -Milliseconds 300
  }
  if (-not $ready) { throw "TypeWords did not become ready. Check logs: $logPath" }
}

if (-not $NoApp) {
  # The user explicitly launches the interactive installed app here.
  if (-not (Get-Process -Name 'knowledge-agent-desktop' -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $appPath
  }
  Write-Output "Installed desktop ready: $appPath"
}
Write-Output 'TypeWords ready: http://127.0.0.1:5567/words'
