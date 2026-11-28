param([ValidateSet('equal_counts','availability')][string]$Mode = 'equal_counts',
    [ValidatePattern('^([a-z0-9-]+)?$')][string]$RunTag = '')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$allocationStem = 'docs/allocation-progress/production-nov2026-20261123/fairness-modes-engine18-runtime-equal-all-holders'
if ($Mode -eq 'availability') { $allocationStem = 'docs/allocation-progress/production-nov2026-20261123/fairness-modes-engine18-runtime-availability-all-holders' }
if ($RunTag) { $allocationStem += '-' + $RunTag }
if ((Test-Path -LiteralPath "$allocationStem.json") -or (Test-Path -LiteralPath "$allocationStem.log")) { throw 'Preserve prior runtime18 replay evidence.' }
railway variables --project 680ef8b0-49be-47cb-a707-3ef9ce1786f5 --service Postgres --environment production --json |
    & backend/.venv/Scripts/python.exe tools/probe_production_balance_readonly.py "$allocationStem.json" "--fairness-mode=$Mode" --server-plan --confirmed-timing-study --all-holder-audit *> "$allocationStem.log"
if ($LASTEXITCODE -ne 0) { throw 'Runtime18 read-only replay failed; inspect local receipt.' }
$allocationReceipt = Get-Content -LiteralPath "$allocationStem.json" -Raw | ConvertFrom-Json
if ($allocationReceipt.status -ne 'simulation_complete' -or $allocationReceipt.finalization_phase -ne 'completed' -or -not $allocationReceipt.database_enforced_readonly -or $allocationReceipt.operational_writes -ne 0) {
    throw 'Runtime18 replay did not finish successfully.'
}
Write-Output 'Actual runtime18 Balance replay completed read-only; no production application.'
