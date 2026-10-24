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
        $progressLedger = Get-Content -LiteralPath (Join-Path $progressDocs 'traceability.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $progressAudit = Get-Content -LiteralPath (Join-Path $progressDocs 'acceptance-audit-current.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        $progressLive = Get-Content -LiteralPath (Join-Path $progressDocs 'live-work.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        Clear-Host
        Write-Host '  DUTY ROTA / FRONTEND PROGRESS' -ForegroundColor Yellow
        Write-Host '  ============================================================' -ForegroundColor DarkYellow
        Write-Host '  Full dashboard: http://127.0.0.1:5199' -ForegroundColor Cyan
        Write-Host '  Frontend only | Read-only status | Refresh every 5 seconds'
        Write-Host ''
        $progressPartial = @($progressLedger.items | Where-Object implementation_status -EQ 'partial').Count
        $progressPending = @($progressLedger.items | Where-Object implementation_status -EQ 'pending').Count
        $progressDependency = @($progressLedger.items | Where-Object implementation_status -EQ 'dependency').Count
        $progressCertified = $progressAudit.counts.whole_requirement_completion_proven
        Write-Host "  TOTAL: $($progressLedger.items.Count)    IN PROGRESS: $progressPartial    PENDING: $progressPending" -ForegroundColor White
        Write-Host "  DEPENDENCIES: $progressDependency    FULLY CERTIFIED: $progressCertified" -ForegroundColor Yellow
        Write-Host '  Passed test batches do not mean whole requirements are complete.' -ForegroundColor Gray
        Write-Host ''
        Write-Host "  CURRENT WORK NOTES (recorded $($progressLive.updated_at))" -ForegroundColor Cyan
        foreach ($progressTask in $progressLive.tasks) {
            Write-Host "  [$($progressTask.status)] $($progressTask.title)" -ForegroundColor Yellow
            Write-Host "    $($progressTask.detail)" -ForegroundColor Gray
        }
        Write-Host ''
        Write-Host '  NEXT PENDING REQUIREMENTS (first 12; full list in dashboard)' -ForegroundColor Cyan
        foreach ($progressItem in @($progressLedger.items | Where-Object implementation_status -EQ 'pending' | Select-Object -First 12)) {
            Write-Host ('  {0:000}  {1}' -f [int]$progressItem.item_id, $progressItem.requirement)
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
