param(
    [Parameter(Mandatory = $true)][string]$WebsiteOrigin,
    [string]$ModelDirectory,
    [ValidateRange(1024,65535)][int]$Port = 11437,
    [switch]$PrepareModel
)
$taskRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$taskPython = Join-Path $taskRoot 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Install the backend environment first.' }
if (-not $ModelDirectory) {
    if (Test-Path -LiteralPath 'D:\CodexModels\DutyRota') { $ModelDirectory = 'D:\CodexModels\DutyRota' }
    else { $ModelDirectory = Join-Path $env:LOCALAPPDATA 'DutyRota\models' }
}
$taskArguments = @((Join-Path $PSScriptRoot 'local_rota_assistant.py'), '--origin', $WebsiteOrigin,
    '--model-directory', $ModelDirectory, '--model', 'qwen2.5:1.5b', '--port', $Port)
if ($PrepareModel) { $taskArguments += '--prepare-model' }
& $taskPython @taskArguments
