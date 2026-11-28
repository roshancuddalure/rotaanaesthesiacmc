param([ValidateRange(16, 99)][int]$Revision = 16)
$ErrorActionPreference = 'Stop'
$allocationRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $allocationRoot
$allocationPython = Join-Path $allocationRoot 'backend/.venv/Scripts/python.exe'
foreach ($allocationMode in @('equal_counts', 'availability')) {
    $allocationTag = if ($allocationMode -eq 'equal_counts') { 'equal' } else { 'availability' }
    $allocationStem = "docs/allocation-progress/production-nov2026-20261123/fairness-modes-engine$Revision-final-performance-$allocationTag-all-holders"
    if ((Test-Path -LiteralPath "$allocationStem.json") -or (Test-Path -LiteralPath "$allocationStem.log")) {
        throw 'Preserve existing November study evidence; this run was not restarted.'
    }
    railway variables --project 680ef8b0-49be-47cb-a707-3ef9ce1786f5 --service Postgres --environment production --json |
        & $allocationPython tools/probe_production_balance_readonly.py "$allocationStem.json" "--fairness-mode=$allocationMode" --server-plan --confirmed-timing-study --all-holder-audit *> "$allocationStem.log"
    if ($LASTEXITCODE -ne 0) { throw "Read-only $allocationTag study failed; inspect the local diagnostic log." }
    Write-Output "Read-only $allocationTag study completed. No production writes."
}
