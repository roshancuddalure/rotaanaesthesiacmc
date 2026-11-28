param([switch]$Joint, [ValidatePattern('^([a-z0-9-]+)?$')][string]$RunTag = '',
    [ValidateRange(1,300)][int]$StudySeconds = 45,
    [ValidateRange(0,200)][double]$DeterministicUnits = 0)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$allocationStem = 'docs/allocation-progress/production-nov2026-20261123/fairness-modes-engine17-clinical-night-flow'
if ($Joint) { $allocationStem += '-joint-model' }
if ($RunTag) { $allocationStem += '-' + $RunTag }
if ((Test-Path -LiteralPath "$allocationStem.json") -or (Test-Path -LiteralPath "$allocationStem.log")) { throw 'Preserve prior clinical-study evidence.' }
$allocationProbeArgs = @('tools/probe_production_balance_readonly.py', "$allocationStem.json", '--fairness-mode=equal_counts', '--server-plan', '--confirmed-timing-study', '--all-holder-audit')
if ($Joint) { $allocationProbeArgs += @('--night-joint-clinical-study', "--joint-study-seconds=$StudySeconds") }
else { $allocationProbeArgs += '--night-clinical-flow-study' }
if ($DeterministicUnits -gt 0) { $allocationProbeArgs += "--joint-deterministic-units=$DeterministicUnits" }
railway variables --project 680ef8b0-49be-47cb-a707-3ef9ce1786f5 --service Postgres --environment production --json |
    & backend/.venv/Scripts/python.exe @allocationProbeArgs *> "$allocationStem.log"
if ($LASTEXITCODE -ne 0) { throw 'Read-only clinical-flow prototype failed; inspect local diagnostic receipt.' }
$allocationReceipt = Get-Content -LiteralPath "$allocationStem.json" -Raw | ConvertFrom-Json
if ($allocationReceipt.status -ne 'simulation_complete' -or -not $allocationReceipt.database_enforced_readonly -or $allocationReceipt.operational_writes -ne 0) {
    throw 'Read-only study did not complete successfully.'
}
Write-Output 'Read-only clinical-flow prototype complete; production and application engine unchanged.'
