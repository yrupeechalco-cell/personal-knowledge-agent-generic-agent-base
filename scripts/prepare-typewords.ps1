param()
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not [Environment]::Is64BitProcess -or $env:OS -ne 'Windows_NT') { throw 'Build the Windows plugin on Windows x64.' }
$cache = Join-Path $root '.artifacts/typewords-build'
$nodeVersion = '24.14.0'
$archiveName = "node-v$nodeVersion-win-x64.zip"
$archive = Join-Path $cache $archiveName
$expectedHash = '313fa40c0d7b18575821de8cb17483031fe07d95de5994f6f435f3b345f85c66'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
  curl.exe --fail --location --retry 3 --output $archive "https://nodejs.org/dist/v$nodeVersion/$archiveName"
  if ($LASTEXITCODE -ne 0) { throw 'Cannot download the official Node runtime.' }
}
$hash = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($archive)
try { $actualHash = [BitConverter]::ToString($hash.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
finally { $stream.Dispose(); $hash.Dispose() }
if ($actualHash -ne $expectedHash) { throw 'Node runtime checksum mismatch.' }
$runtime = Join-Path $cache "node-v$nodeVersion-win-x64"
if (-not (Test-Path -LiteralPath "$runtime/node.exe")) {
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::ExtractToDirectory($archive, $cache)
}
$node = Join-Path $runtime 'node.exe'
$npmCli = Join-Path $runtime 'node_modules/npm/bin/npm-cli.js'
$previousPath = $env:PATH
$previousPreset = $env:NITRO_PRESET
$previousTelemetry = $env:NUXT_TELEMETRY_DISABLED
try {
  $env:PATH = "$runtime;$previousPath"
  $env:NITRO_PRESET = 'node-server'
  $env:NUXT_TELEMETRY_DISABLED = '1'
  Push-Location $root
  try {
    & $node scripts/check-typewords-source.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Third-party source verification failed.' }
    & $node scripts/copy-typewords-build-source.mjs
    if ($LASTEXITCODE -ne 0) { throw 'TypeWords build source preparation failed.' }
  } finally { Pop-Location }
  Push-Location (Join-Path $cache 'source')
  try {
    & $node $npmCli exec --yes --package=pnpm@11.24.0 -- pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'TypeWords dependency installation failed.' }
    & $node $npmCli exec --yes --package=pnpm@11.24.0 -- pnpm run build
    if ($LASTEXITCODE -ne 0) { throw 'TypeWords production build failed.' }
  } finally { Pop-Location }
  # Build an isolated copy: generated declarations must not modify the source snapshot.
  & $node (Join-Path $root 'scripts/stage-typewords.mjs') $runtime
  if ($LASTEXITCODE -ne 0) { throw 'TypeWords resource staging failed.' }
} finally {
  $env:PATH = $previousPath
  $env:NITRO_PRESET = $previousPreset
  $env:NUXT_TELEMETRY_DISABLED = $previousTelemetry
}
