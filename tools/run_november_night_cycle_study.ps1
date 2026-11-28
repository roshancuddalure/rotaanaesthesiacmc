param([switch]$Prioritized, [switch]$StructuralAudit, [switch]$CohortAudit)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$allocationStem = 'docs/allocation-progress/production-nov2026-20261123/fairness-modes-engine17-night-cycle-equal-study'
if ($Prioritized) { $allocationStem += '-prioritized' }
if ($StructuralAudit) { $allocationStem += '-structural-audit' }
if ($CohortAudit) { $allocationStem += '-cohort-audit' }
if ((Test-Path -LiteralPath "$allocationStem.json") -or (Test-Path -LiteralPath "$allocationStem.log")) { throw 'Preserve prior cycle-study evidence.' }
$allocationProbeArgs = @('tools/probe_production_balance_readonly.py', "$allocationStem.json", '--fairness-mode=equal_counts', '--server-plan', '--confirmed-timing-study', '--all-holder-audit', '--night-cycle-study')
if ($CohortAudit) { $allocationProbeArgs += '--night-category-cohort-audit' }
railway variables --project 680ef8b0-49be-47cb-a707-3ef9ce1786f5 --service Postgres --environment production --json |
    & backend/.venv/Scripts/python.exe @allocationProbeArgs *> "$allocationStem.log"
if ($LASTEXITCODE -ne 0) { throw 'Read-only night cycle experiment failed; inspect local diagnostic log.' }
Write-Output 'Read-only night cycle experiment complete; engine and production unchanged.'
