# Palleta dual-source public catalog sync. No secrets stored in this script.
param(
  [string]$RepoDir = 'D:\PalletaMenu',
  [string]$RetailPricesCsv = 'D:\PalletaExport\retail_prices.csv',
  [string]$UTStockCsv = 'D:\PalletaExport\ut_saleable_stock.csv',
  [string]$StoreKey = '',
  [string]$Python = 'py',
  [int]$MaxAgeMinutes = 20,
  [int]$MaxSkewMinutes = 15
)
$ErrorActionPreference = 'Stop'
if (-not $StoreKey -or $StoreKey -eq 'STORE_KEY_FROM_1C') {
  throw 'Specify approved -StoreKey shared by BOTH 1C exports; not configured.'
}
Set-Location -LiteralPath $RepoDir
foreach($p in @($RetailPricesCsv, $UTStockCsv)) {
  if (-not (Test-Path -LiteralPath $p)) { throw "Missing export: $p" }
  if ((Get-Item -LiteralPath $p).LastWriteTime -lt (Get-Date).AddMinutes(-$MaxAgeMinutes)) {
    throw "Stale export file: $p"
  }
}
$dirty = @(git status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) {
  throw 'Git working directory must be clean before sync'
}
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Cannot fast-forward main' }
$common = @('--prices', $RetailPricesCsv, '--stock', $UTStockCsv, '--store-key', $StoreKey,
            '--max-age-minutes', $MaxAgeMinutes, '--max-skew-minutes', $MaxSkewMinutes)
& $Python sync_1c_dual.py @common --dry-run
if ($LASTEXITCODE -ne 0) { throw 'Dual-source CSV validation failed: NO PUBLICATION' }
& $Python sync_1c_dual.py @common
if ($LASTEXITCODE -ne 0) { throw 'Dual-source merge failed: NO PUBLICATION' }
git add -- products.json
if ($LASTEXITCODE -ne 0) { throw 'Cannot stage public catalog' }
$changed = @(git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect staged diff' }
if ($changed.Count -eq 0) { Write-Output 'PASS: no change in approved public snapshot'; exit 0 }
if ($changed.Count -ne 1 -or $changed[0] -ne 'products.json') {
  throw 'Unexpected staged path; refusing publish'
}
git commit -m 'Sync cashier prices from Retail and approved saleable quantity from UT'
if ($LASTEXITCODE -ne 0) { throw 'Git commit failed' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'Git push failed; local commit not published' }
Write-Output 'PASS: approved public prices and availability pushed to GitHub Pages'