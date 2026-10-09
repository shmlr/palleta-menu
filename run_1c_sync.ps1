# Palleta public catalog updater for Windows Task Scheduler.
# PRECONDITION: a trusted 1C process creates the approved fresh CSV first.
# No 1C tokens, no GitHub tokens, no credentials in this file.
param(
  [string]$RepoDir = 'D:\PalletaMenu',
  [string]$CsvPath = 'D:\PalletaExport\approved_public_prices_stock.csv',
  [string]$Python = 'py',
  [int]$MaxAgeMinutes = 20
)
$ErrorActionPreference='Stop'
Set-Location -LiteralPath $RepoDir
if (-not (Test-Path -LiteralPath $CsvPath)) { throw "Approved CSV is missing: $CsvPath" }
$lastChanged=(Get-Item -LiteralPath $CsvPath).LastWriteTime
if ($lastChanged -lt (Get-Date).AddMinutes(-$MaxAgeMinutes)) { throw "CSV file is stale: $lastChanged" }
if ((git status --porcelain) -ne $null) {
    $dirty = @(git status --porcelain)
    if ($dirty.Count -gt 0) { throw 'Repository has local changes. Sync aborted to avoid overriding unrelated work.' }
}
git pull --ff-only origin main
if ($LASTEXITCODE -ne 0) { throw 'Cannot fast-forward main' }
& $Python sync_1c_export.py --csv $CsvPath --dry-run --require-all-codes --max-age-minutes $MaxAgeMinutes
if ($LASTEXITCODE -ne 0) { throw 'CSV validation failed. No update was published.' }
& $Python sync_1c_export.py --csv $CsvPath --require-all-codes --max-age-minutes $MaxAgeMinutes
if ($LASTEXITCODE -ne 0) { throw 'Public catalog conversion failed' }
git add -- products.json
if ($LASTEXITCODE -ne 0) { throw 'git add failed' }
$changed = @(git diff --cached --name-only)
if ($changed.Count -ne 1 -or $changed[0] -ne 'products.json') { throw 'Unexpected staged files, refusing to push' }
git commit -m 'Sync approved public retail price and saleable stock from 1C'
if ($LASTEXITCODE -ne 0) { throw 'git commit failed' }
git push origin main
if ($LASTEXITCODE -ne 0) { throw 'git push failed' }
Write-Output 'PASS: approved public catalog pushed; GitHub Pages will redeploy.'