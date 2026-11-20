$ErrorActionPreference = 'Stop'
$progressRoot = Split-Path -Parent $PSScriptRoot
$progressDocs = Join-Path $progressRoot 'docs\premium-ui'
$Host.UI.RawUI.WindowTitle = 'Duty Rota | Frontend Progress'
try {
    $Host.UI.RawUI.BackgroundColor = 'DarkBlue'
    $Host.UI.RawUI.ForegroundColor = 'White'
} catch { }

while ($true) {
    try {
        # Consume the compact read-only dashboard response instead of expanding the
        # multi-megabyte evidence register into PowerShell objects every five seconds.
        $progressSnapshot = Invoke-RestMethod -Uri 'http://127.0.0.1:5199/progress.json' -TimeoutSec 8
        $progressLive = $progressSnapshot.live
        Clear-Host
        Write-Host '  DUTY ROTA / FRONTEND PROGRESS' -ForegroundColor Yellow
        Write-Host '  ============================================================' -ForegroundColor DarkYellow
        Write-Host '  Full dashboard: http://127.0.0.1:5199' -ForegroundColor Cyan
        Write-Host '  Frontend only | Read-only status | Refresh every 5 seconds'
        Write-Host ''
        $progressPartial = [int]$progressSnapshot.counts.partial
        $progressPending = [int]$progressSnapshot.counts.pending
        $progressDependency = [int]$progressSnapshot.counts.dependency
        $progressCertified = [int]$progressSnapshot.certified
        Write-Host "  TOTAL: $($progressSnapshot.total)    IN PROGRESS: $progressPartial    PENDING: $progressPending" -ForegroundColor White
        Write-Host "  DEPENDENCIES: $progressDependency    RECORDED SIGN-OFFS: $progressCertified" -ForegroundColor Yellow
        Write-Host '  Concurrent source changes can require revalidation of earlier checks.' -ForegroundColor Gray
        Write-Host '  Passed test batches do not mean whole requirements are complete.' -ForegroundColor Gray
        Write-Host ''
        $progressEstimate = $progressLive.time_estimate
        $progressEstimateValid = $null -ne $progressEstimate
        foreach ($progressEstimateField in @('hours_per_item_low', 'hours_per_item_high', 'integration_hours_low', 'integration_hours_high')) {
            $progressEstimateValue = $progressEstimate.$progressEstimateField
            $progressNumeric = $progressEstimateValue -is [int] -or $progressEstimateValue -is [long] -or $progressEstimateValue -is [double] -or $progressEstimateValue -is [decimal] -or $progressEstimateValue -is [single]
            if (-not $progressNumeric -or [double]::IsNaN([double]$progressEstimateValue) -or [double]::IsInfinity([double]$progressEstimateValue) -or $progressEstimateValue -lt 0) { $progressEstimateValid = $false }
        }
        if ($progressEstimateValid -and ($progressEstimate.hours_per_item_low -gt $progressEstimate.hours_per_item_high -or $progressEstimate.integration_hours_low -gt $progressEstimate.integration_hours_high)) { $progressEstimateValid = $false }
        if ($progressEstimateValid) {
            $progressRemaining = @($progressSnapshot.items | Where-Object { $_.status -ne 'complete' -and $_.status -ne 'dependency' }).Count
            $progressLow = [math]::Ceiling(($progressRemaining * $progressEstimate.hours_per_item_low + $progressEstimate.integration_hours_low) / 10) * 10
            $progressHigh = [math]::Ceiling(($progressRemaining * $progressEstimate.hours_per_item_high + $progressEstimate.integration_hours_high) / 10) * 10
            Write-Host "  ESTIMATED TIME LEFT: $progressLow-$progressHigh active working hours" -ForegroundColor Yellow
            Write-Host "  Current batch: $($progressEstimate.current_batch)" -ForegroundColor Cyan
            Write-Host "  Low-confidence scope estimate | Reviewed: $($progressEstimate.reviewed_at)" -ForegroundColor Gray
            Write-Host '  Not a countdown or promised finish date; external device checks excluded.' -ForegroundColor Gray
            Write-Host ''
        } else {
            Write-Host '  ESTIMATED TIME LEFT: awaiting review' -ForegroundColor Yellow
            Write-Host '  Estimate values are missing or invalid; no duration inferred.' -ForegroundColor Gray
            Write-Host ''
        }
        Write-Host "  CURRENT WORK NOTES (recorded $($progressLive.updated_at))" -ForegroundColor Cyan
        foreach ($progressTask in $progressLive.tasks) {
            Write-Host "  [$($progressTask.status)] $($progressTask.title)" -ForegroundColor Yellow
            Write-Host "    $($progressTask.detail)" -ForegroundColor Gray
        }
        Write-Host ''
        Write-Host '  NEXT PENDING REQUIREMENTS (first 12; full list in dashboard)' -ForegroundColor Cyan
        foreach ($progressItem in @($progressSnapshot.items | Where-Object status -EQ 'pending' | Select-Object -First 12)) {
            Write-Host ('  {0:000}  {1}' -f [int]$progressItem.id, $progressItem.requirement)
        }
        Write-Host ''
        Write-Host '  Physical checks pending. Work notes are not live process monitoring.' -ForegroundColor Gray
        Write-Host '  Ctrl+C stops this viewer. Closing it does not change the rota app.' -ForegroundColor Gray
    } catch {
        Write-Host "Progress files temporarily unavailable: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host 'Retrying in 5 seconds. No files have been changed.'
    }
    Start-Sleep -Seconds 5
}
