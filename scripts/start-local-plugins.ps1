param([string]$TypeWordsPath, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$repoPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $TypeWordsPath) { $TypeWordsPath = Join-Path $repoPath 'third_party\typewords' }
if (-not (Test-Path -LiteralPath (Join-Path $TypeWordsPath '.output\server\index.mjs'))) { throw 'TypeWords build not found. Supply -TypeWordsPath with the installed folder.' }
if (-not (Test-Path -LiteralPath (Join-Path $repoPath 'apps\web\dist\index.html'))) { throw 'Build the knowledge workspace first: npm run build:web' }
$nodeCommand = Get-Command node -ErrorAction Stop
$logPath = Join-Path $repoPath '.local-plugin-logs'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null

function Test-LocalApp([string]$Url, [string]$Marker) {
  try { $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2 } catch { return $false }
  if ($response.Content -notmatch $Marker) { throw "Another application is using $Url. Stop that application or check its port before continuing." }
  return $true
}

function Wait-LocalApp([string]$Url, [string]$Marker, $Process) {
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if (Test-LocalApp $Url $Marker) { return }
    $Process.Refresh()
    if ($Process.HasExited) { throw "Service exited. Check logs in $logPath" }
    Start-Sleep -Milliseconds 300
  }
  throw "Service did not become ready: $Url. Check logs in $logPath"
}

if (-not (Test-LocalApp 'http://127.0.0.1:5567/' 'Type\s?Words|Type Words')) {
  $oldNitroHost = $env:NITRO_HOST
  $oldNitroPort = $env:NITRO_PORT
  try {
    $env:NITRO_HOST = '127.0.0.1'
    $env:NITRO_PORT = '5567'
    $typeWordsProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList '.output/server/index.mjs' -WorkingDirectory $TypeWordsPath -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'typewords.log') -RedirectStandardError (Join-Path $logPath 'typewords-error.log') -PassThru
    Wait-LocalApp 'http://127.0.0.1:5567/' 'Type\s?Words|Type Words' $typeWordsProcess
  } finally { $env:NITRO_HOST = $oldNitroHost; $env:NITRO_PORT = $oldNitroPort }
}

if (-not (Test-LocalApp 'http://127.0.0.1:5174/' '<title>Personal Knowledge Agent</title>')) {
  $workspaceProcess = Start-Process -FilePath $nodeCommand.Source -ArgumentList '../../node_modules/vite/bin/vite.js','preview','--host','127.0.0.1','--port','5174','--strictPort' -WorkingDirectory (Join-Path $repoPath 'apps\web') -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logPath 'workspace.log') -RedirectStandardError (Join-Path $logPath 'workspace-error.log') -PassThru
  Wait-LocalApp 'http://127.0.0.1:5174/' '<title>Personal Knowledge Agent</title>' $workspaceProcess
}

$launchUrl = 'http://127.0.0.1:5174/?plugin=typewords'
Write-Output "Ready: $launchUrl"
if (-not $NoBrowser) { Start-Process $launchUrl }
