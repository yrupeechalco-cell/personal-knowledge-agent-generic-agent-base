param(
  [string]$ProjectName = "personal-knowledge-agent",
  [string]$Branch = "master"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$accountId = if ($env:CLOUDFLARE_ACCOUNT_ID) {
  $env:CLOUDFLARE_ACCOUNT_ID
} else {
  "3fff5eef154ffc425836ac8a5218592a"
}

Push-Location $root
try {
  npm run build:web
  if ($LASTEXITCODE -ne 0) { throw "Web build failed." }

  $dist = Join-Path $root "apps/web/dist"
  $sensitivePatterns = @(
    'sk-[A-Za-z0-9_-]{16,}',
    'BEGIN.*PRIVATE KEY',
    'C:\\Users\\',
    'F:\\个人知识库Agent项目数据'
  )
  $matches = Get-ChildItem -LiteralPath $dist -Recurse -File |
    Select-String -Pattern $sensitivePatterns -AllMatches -ErrorAction SilentlyContinue
  if ($matches) {
    throw "Web output contains a sensitive local value; deployment stopped."
  }

  $env:CLOUDFLARE_ACCOUNT_ID = $accountId
  npx --yes wrangler@4.110.0 pages deploy $dist `
    --project-name $ProjectName `
    --branch $Branch `
    --commit-dirty=true
  if ($LASTEXITCODE -ne 0) { throw "Cloudflare Pages deployment failed." }

  Write-Output "Published https://$ProjectName.pages.dev/"
} finally {
  Pop-Location
}
