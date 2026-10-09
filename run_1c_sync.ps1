# Palleta sync: single approved UT 11 export -> public GitHub catalog.
# Requires external UT scheduled exporter, local Python and Git authentication.
# No tokens or 1C credentials are stored here.
param(
  [string]$RepoDir = 'D:\PalletaMenu',
  [string]$UTCsv = 'D:\PalletaExport\ut_public_catalog.csv',
  [string]$StoreKey = '',
  [string]$PriceType = '',
  [string]$Python = 'py',
  [int]$MaxAgeMinutes = 20
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($StoreKey) -or [string]::IsNullOrWhiteSpace($PriceType)) {
  throw 'Specify approved -StoreKey and -PriceType from the UT export'
}
if (-not (Test-Path -LiteralPath $RepoDir -PathType Container)) { throw "No repo: $RepoDir" }
if (-not (Test-Path -LiteralPath $UTCsv -PathType Leaf)) { throw "No UT CSV: $UTCsv" }
if ((Get-Item -LiteralPath $UTCsv).LastWriteTime -lt (Get-Date).AddMinutes(-$MaxAgeMinutes)) {
  throw 'UT export file too old'
}
Set-Location -LiteralPath $RepoDir
$dirty = @(git status --porcelain)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) { throw 'Uncommitted files: publication aborted' }
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'git pull failed' }
$argsCommon = @('--csv', $UTCsv, '--store-key', $StoreKey, '--price-type', $PriceType,
                '--max-age-minutes', [string]$MaxAgeMinutes)
& $Python sync_ut_catalog.py @argsCommon --dry-run
if ($LASTEXITCODE -ne 0) { throw 'UT validation failed. No publication.' }
& $Python sync_ut_catalog.py @argsCommon
if ($LASTEXITCODE -ne 0) { throw 'UT import failed. No publication.' }
git add -- products.json
if ($LASTEXITCODE -ne 0) { throw 'git add failed' }
$changed = @(git diff --cached --name-only)
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify staged files' }
if ($changed.Count -eq 0) { Write-Output 'PASS: catalog unchanged'; exit 0 }
if ($changed.Count -ne 1 -or $changed[0] -ne 'products.json') { throw 'Unexpected staged file(s)' }
git commit -m 'Publish approved UT11 retail prices and saleable stock'
if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
Write-Output 'PASS: approved UT11 snapshot pushed; Pages deployment triggered.'