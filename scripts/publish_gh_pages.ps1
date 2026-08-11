# Publish app/boat-frontend static export to the gh-pages branch.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$env:NEXT_PUBLIC_SOLANA_RPC = "https://api.devnet.solana.com"
$env:BASE_PATH = "/BOAT-Protocol-Ballot-Oversight-And-Tranparency"

Write-Host "Building SDK..."
Push-Location packages/boat-sdk
npm ci
npm run build
Pop-Location

Write-Host "Building web with BASE_PATH=$env:BASE_PATH ..."
Push-Location app/boat-frontend
npm ci
npx next build --webpack
if (-not (Test-Path out/index.html)) { throw "out/index.html missing" }
$index = Get-Content out/index.html -Raw
$assetNeedle = "$($env:BASE_PATH)/_next/"
$adminNeedle = "$($env:BASE_PATH)/admin/"
if ($index -notlike "*$assetNeedle*") {
  throw "basePath missing from out/index.html asset URLs - aborting publish"
}
if ($index -notlike "*$adminNeedle*") {
  throw "basePath missing from admin link - aborting publish"
}
Pop-Location

$tmp = Join-Path $env:TEMP ("boat-gh-pages-" + [guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null
Copy-Item -Recurse -Force "app/boat-frontend/out/*" $tmp
New-Item -ItemType File -Path (Join-Path $tmp ".nojekyll") -Force | Out-Null

Push-Location $tmp
git init -b gh-pages | Out-Null
git add -A
git -c user.email="boat-pages@local" -c user.name="BOAT Pages" commit -m "Publish BOAT web with correct GitHub Pages basePath"
$remote = (git -C $Root remote get-url origin)
git push -f $remote gh-pages:gh-pages
Pop-Location

Remove-Item -Recurse -Force $tmp
Write-Host "Published. Open https://brighammurdoch-byte.github.io/BOAT-Protocol-Ballot-Oversight-And-Tranparency/"
