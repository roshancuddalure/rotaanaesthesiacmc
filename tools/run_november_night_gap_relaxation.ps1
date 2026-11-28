param([switch]$ExactFlow, [switch]$FlexibleCounts, [switch]$CountCost,
    [ValidatePattern('^([a-z0-9-]+)?$')][string]$RunTag = '')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$allocationStem = 'docs/allocation-progress/production-nov2026-20261123/fairness-modes-engine17-night-gap-two-relaxation'
if ($ExactFlow) { $allocationStem += '-exact-flow' }
if ($FlexibleCounts) { $allocationStem += '-flexible-counts' }
if ($CountCost) {
    if (-not $FlexibleCounts) { throw 'Count-cost proof requires explicit variable-count scope.' }
    $allocationStem += '-count-cost'
}
if ($RunTag) { $allocationStem += '-' + $RunTag }
if ((Test-Path -LiteralPath "$allocationStem.json") -or (Test-Path -LiteralPath "$allocationStem.log")) { throw 'Preserve prior night-gap proof evidence.' }
$allocationProbeArgs = @('tools/probe_production_balance_readonly.py', "$allocationStem.json", '--fairness-mode=equal_counts', '--server-plan', '--confirmed-timing-study', '--all-holder-audit', '--night-gap-relaxation-study')
if ($FlexibleCounts) { $allocationProbeArgs += '--night-gap-flexible-counts-study' }
if ($CountCost) { $allocationProbeArgs += '--night-gap-count-cost-study' }
railway variables --project 680ef8b0-49be-47cb-a707-3ef9ce1786f5 --service Postgres --environment production --json |
    & backend/.venv/Scripts/python.exe @allocationProbeArgs *> "$allocationStem.log"
if ($LASTEXITCODE -ne 0) { throw 'Read-only night-gap diagnostic failed; inspect local diagnostic log.' }
$allocationReceipt = Get-Content -LiteralPath "$allocationStem.json" -Raw | ConvertFrom-Json
if ($allocationReceipt.status -ne 'simulation_complete' -or -not $allocationReceipt.database_enforced_readonly -or $allocationReceipt.operational_writes -ne 0) {
    throw 'Read-only diagnostic receipt did not complete successfully; no success claim is permitted.'
}
Write-Output 'Read-only night-gap diagnostic complete; no Apply token or production changes.'
