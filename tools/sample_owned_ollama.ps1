param(
    [Parameter(Mandatory=$true)][string]$IdentityPath,
    [Parameter(Mandatory=$true)][string]$OutputPath,
    [Parameter(Mandatory=$true)][string]$StopPath,
    [ValidateRange(2,3600)][int]$MaximumSeconds = 1800,
    [ValidateRange(1,30)][int]$IntervalSeconds = 2
)
$ErrorActionPreference = 'Stop'
if (Test-Path -LiteralPath $OutputPath) { throw 'Retain existing resource evidence; choose a new output.' }
$sampleIdentity = Get-Content -Raw -LiteralPath $IdentityPath | ConvertFrom-Json
if ($sampleIdentity.port -ne 11438 -or -not $sampleIdentity.cloud_disabled) { throw 'Expected the dedicated owned loopback runtime.' }
$sampleRoot = Get-Process -Id $sampleIdentity.pid
if ($sampleRoot.StartTime.ToUniversalTime().ToString('o') -ne $sampleIdentity.started_at) { throw 'Runtime process start identity changed.' }
$sampleListeners = @(Get-NetTCPConnection -State Listen -LocalPort 11438)
if ($sampleListeners.Count -eq 0 -or @($sampleListeners | Where-Object {$_.OwningProcess -ne $sampleIdentity.pid}).Count -gt 0) { throw 'Runtime listener owner mismatch.' }
$sampleReport = [ordered]@{
    complete=$false; started_at=[DateTimeOffset]::UtcNow.ToString('o'); root_pid=$sampleIdentity.pid;
    scope='Sampled owned runtime/descendant working sets and Ollama-reported model VRAM allocation. Not continuous peaks or unique physical RAM; excludes evaluation client.';
    requested_interval_seconds=$IntervalSeconds; sampled_peak_tree_working_set_bytes=0L; sampled_peak_reported_vram_bytes=0L; samples=@(); stop_reason=$null
}
$sampleTimer = [Diagnostics.Stopwatch]::StartNew()
while ($sampleTimer.Elapsed.TotalSeconds -lt $MaximumSeconds) {
    if (Test-Path -LiteralPath $StopPath) { $sampleReport.stop_reason='explicit_stop_marker'; break }
    $sampleRoot = Get-Process -Id $sampleIdentity.pid -ErrorAction SilentlyContinue
    if (-not $sampleRoot) { $sampleReport.stop_reason='owned_runtime_exited'; break }
    if ($sampleRoot.StartTime.ToUniversalTime().ToString('o') -ne $sampleIdentity.started_at) { $sampleReport.stop_reason='process_identity_changed'; break }
    $sampleAll = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId)
    $sampleIds = @([int]$sampleIdentity.pid)
    do {
        $sampleChildren = @($sampleAll | Where-Object { $_.ParentProcessId -in $sampleIds -and $_.ProcessId -notin $sampleIds } | ForEach-Object {[int]$_.ProcessId})
        $sampleIds += $sampleChildren
    } while ($sampleChildren.Count -gt 0)
    $sampleProcesses = @(Get-Process -Id $sampleIds -ErrorAction SilentlyContinue)
    $sampleWorkingSet = [long](($sampleProcesses | Measure-Object WorkingSet64 -Sum).Sum)
    $sampleVram = $null
    $sampleError = $null
    try {
        $sampleResident = Invoke-RestMethod http://127.0.0.1:11438/api/ps -TimeoutSec 2
        $sampleVram = [long](($sampleResident.models | Measure-Object size_vram -Sum).Sum)
    } catch { $sampleError = $_.Exception.GetType().Name }
    $sampleReport.sampled_peak_tree_working_set_bytes = [math]::Max($sampleReport.sampled_peak_tree_working_set_bytes,$sampleWorkingSet)
    if ($null -ne $sampleVram) { $sampleReport.sampled_peak_reported_vram_bytes = [math]::Max($sampleReport.sampled_peak_reported_vram_bytes,$sampleVram) }
    $sampleReport.samples += [pscustomobject]@{at=[DateTimeOffset]::UtcNow.ToString('o'); elapsed_seconds=$sampleTimer.Elapsed.TotalSeconds; owned_process_ids=$sampleIds; process_count_read=$sampleProcesses.Count; tree_snapshot_complete=($sampleProcesses.Count -eq $sampleIds.Count); tree_working_set_bytes=$sampleWorkingSet; reported_vram_bytes=$sampleVram; runtime_observation_error=$sampleError}
    $sampleReport | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $OutputPath -Encoding utf8
    Start-Sleep -Seconds $IntervalSeconds
}
if (-not $sampleReport.stop_reason) { $sampleReport.stop_reason='observation_budget_reached' }
$sampleReport.complete=$true
$sampleReport.finished_at=[DateTimeOffset]::UtcNow.ToString('o')
$sampleReport | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $OutputPath -Encoding utf8
Write-Output ('Resource observations complete: ' + $sampleReport.samples.Count)
