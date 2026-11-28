$ErrorActionPreference = 'Stop'
$allocationRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $allocationRoot
$allocationStem = 'docs/allocation-progress/production-nov2026-20261123/fairness-modes-engine16-hours512-equal-all-holders'
if ((Test-Path -LiteralPath "$allocationStem.json") -or (Test-Path -LiteralPath "$allocationStem.log")) {
    throw 'Preserve earlier hours experiment evidence.'
}
railway variables --project 680ef8b0-49be-47cb-a707-3ef9ce1786f5 --service Postgres --environment production --json |
    & backend/.venv/Scripts/python.exe tools/probe_production_balance_readonly.py "$allocationStem.json" --fairness-mode=equal_counts --server-plan --confirmed-timing-study --all-holder-audit --hours-trial-study=512 *> "$allocationStem.log"
if ($LASTEXITCODE -ne 0) { throw 'Read-only hours experiment failed; inspect its local diagnostic log.' }
Write-Output 'Read-only hours experiment completed; main engine and production unchanged.'
