param(
  [Parameter(Mandatory = $true)]
  [string]$Version,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$repo = "yrupeechalco-cell/personal-knowledge-agent-generic-agent-base"
$tag = "app-v$Version"
$privateKey = Join-Path $root ".private/updater/knowledge-agent.key"
$privatePassword = Join-Path $root ".private/updater/password.txt"
$bundleDir = Join-Path $root "apps/desktop/src-tauri/target/release/bundle/nsis"
$sourceInstaller = Join-Path $bundleDir "个人知识库 Agent_${Version}_x64-setup.exe"
$sourceSignature = "$sourceInstaller.sig"
$stagingDir = Join-Path $root ".artifacts/release-$Version"
$assetName = "knowledge-agent_${Version}_x64-setup.exe"
$assetInstaller = Join-Path $stagingDir $assetName
$assetSignature = "$assetInstaller.sig"
$manifestPath = Join-Path $stagingDir "latest.json"

Push-Location $root
try {
  npm run version:check
  if ($LASTEXITCODE -ne 0) { throw "Version fields are not synchronized." }

  if (-not $SkipBuild) {
    if (-not (Test-Path $privateKey) -or -not (Test-Path $privatePassword)) {
      throw "Updater signing secrets are missing from .private/updater."
    }
    $env:TAURI_SIGNING_PRIVATE_KEY = [IO.File]::ReadAllText($privateKey)
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [IO.File]::ReadAllText($privatePassword)
    npm run tauri -w apps/desktop -- build
    if ($LASTEXITCODE -ne 0) { throw "Signed Tauri build failed." }
  }

  if (-not (Test-Path $sourceInstaller) -or -not (Test-Path $sourceSignature)) {
    throw "Signed installer artifacts for $Version were not found."
  }

  New-Item -ItemType Directory -Force $stagingDir | Out-Null
  Copy-Item -LiteralPath $sourceInstaller -Destination $assetInstaller -Force
  Copy-Item -LiteralPath $sourceSignature -Destination $assetSignature -Force

  $signature = [IO.File]::ReadAllText($sourceSignature).Trim()
  $downloadUrl = "https://github.com/$repo/releases/download/$tag/$assetName"
  $manifest = [ordered]@{
    version = $Version
    notes = "Knowledge Agent $Version Windows release. See CHANGELOG.md for details."
    pub_date = (Get-Date).ToUniversalTime().ToString("o")
    platforms = [ordered]@{
      "windows-x86_64" = [ordered]@{
        signature = $signature
        url = $downloadUrl
      }
    }
  } | ConvertTo-Json -Depth 6
  [IO.File]::WriteAllText($manifestPath, $manifest, [Text.UTF8Encoding]::new($false))

  gh release view $tag --repo $repo *> $null
  if ($LASTEXITCODE -eq 0) {
    gh release upload $tag $assetInstaller $assetSignature $manifestPath --clobber --repo $repo
    gh release edit $tag --title "Knowledge Agent v$Version" --notes-file CHANGELOG.md --latest --repo $repo
  } else {
    gh release create $tag $assetInstaller $assetSignature $manifestPath --target master --title "Knowledge Agent v$Version" --notes-file CHANGELOG.md --latest --repo $repo
  }
  if ($LASTEXITCODE -ne 0) { throw "GitHub Release publication failed." }

  Write-Output "Published $tag with signed installer and latest.json."
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
  Pop-Location
}
