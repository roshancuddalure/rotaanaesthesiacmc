param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$allocationRoot = Split-Path -Parent $PSScriptRoot
$allocationUrl = 'http://127.0.0.1:5201'
$allocationIdentity = 'duty-rota-allocation-progress-v1'
$allocationService = $null
try { $allocationService = Invoke-RestMethod "$allocationUrl/health" -TimeoutSec 2 } catch { }
if ($allocationService -and $allocationService.identity -ne $allocationIdentity) {
    throw 'Port 5201 belongs to another service. Leave it running and select another port explicitly.'
}
if (-not $allocationService) {
    $allocationListener = Get-NetTCPConnection -LocalPort 5201 -State Listen -ErrorAction SilentlyContinue
    if ($allocationListener) { throw 'Port 5201 is occupied by an unidentified service; it has not been stopped.' }
    $allocationPython = Join-Path $allocationRoot 'backend\.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $allocationPython)) { $allocationPython = (Get-Command python).Source }
    $allocationScript = Join-Path $PSScriptRoot 'allocation_progress.py'
    $allocationProcess = Start-Process -FilePath $allocationPython -ArgumentList @('"' + $allocationScript + '"') -WorkingDirectory $allocationRoot -WindowStyle Hidden -PassThru
    for ($allocationAttempt = 0; $allocationAttempt -lt 30; $allocationAttempt++) {
        try { $allocationService = Invoke-RestMethod "$allocationUrl/health" -TimeoutSec 1; break } catch { Start-Sleep -Milliseconds 200 }
    }
    if (-not $allocationService -or $allocationService.identity -ne $allocationIdentity) { throw "Allocation GUI failed to start (PID $($allocationProcess.Id))." }
}
if (-not $NoOpen) { Start-Process $allocationUrl }
Write-Output "Allocation progress GUI: $allocationUrl"
