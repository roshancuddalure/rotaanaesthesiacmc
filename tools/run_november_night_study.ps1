param([switch]$TargetExtremes, [switch]$BeforeHours)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$allocationStem = 'docs/allocation-progress/production-nov2026-20261123/fairness-modes-engine16-night-equal-study'
if ($TargetExtremes) { $allocationStem += '-extremes' }
if ($BeforeHours) { $allocationStem += '-before-hours' }
if ((Test-Path -LiteralPath "$allocationStem.json") -or (Test-Path -LiteralPath "$allocationStem.log")) {
    throw 'Preserve previous night-study evidence.'
}
$allocationStudyArgs = @('tools/probe_production_balance_readonly.py', "$allocationStem.json", '--fairness-mode=equal_counts', '--server-plan', '--confirmed-timing-study', '--all-holder-audit', '--night-exchange-study')
if ($TargetExtremes) { $allocationStudyArgs += '--night-extremes-study' }
if ($BeforeHours) {
    $allocationStudyArgs = $allocationStudyArgs | Where-Object { $_ -ne '--night-exchange-study' }
    $allocationStudyArgs += '--night-before-hours-study'
}
railway variables --project 680ef8b0-49be-47cb-a707-3ef9ce1786f5 --service Postgres --environment production --json |
    & backend/.venv/Scripts/python.exe @allocationStudyArgs *> "$allocationStem.log"
if ($LASTEXITCODE -ne 0) { throw 'Read-only night study failed; inspect its local diagnostic log.' }
Write-Output 'Read-only night experiment complete; engine and production unchanged.'
