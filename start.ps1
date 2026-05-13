param(
    [switch]$SkipBrowser
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$BackendPython = Join-Path $Backend ".venv\Scripts\python.exe"
$FrontendNodeModules = Join-Path $Frontend "node_modules"
$BackendUrl = "http://127.0.0.1:8000"
$FrontendUrl = "http://127.0.0.1:5173"

function Test-BackendDependencies {
    Set-Location $Backend
    & $BackendPython -c "import importlib.util; missing = [name for name in ('alembic', 'fastapi', 'openpyxl', 'pandas', 'psycopg', 'pytest', 'sqlalchemy', 'uvicorn') if importlib.util.find_spec(name) is None]; raise SystemExit(1 if missing else 0)" *> $null
    return $LASTEXITCODE -eq 0
}

function Test-DatabaseConnection {
    Set-Location $Backend
    & $BackendPython -c "from app.db.session import engine; conn = engine.connect(); conn.exec_driver_sql('select 1'); conn.close()" *> $null
    return $LASTEXITCODE -eq 0
}

function Invoke-NativeCommand {
    param(
        [string]$FailureMessage,
        [scriptblock]$Command
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }
}

function Start-DutyRotaProcess {
    param(
        [string]$Title,
        [string]$WorkingDirectory,
        [string]$Command
    )

    Start-Process powershell -WindowStyle Normal -ArgumentList @(
        "-NoExit",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Set-Location '$WorkingDirectory'; `$Host.UI.RawUI.WindowTitle = '$Title'; $Command"
    )
}

function Test-HttpOk {
    param([string]$Url)

    try {
        $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
        return $Response.StatusCode -ge 200 -and $Response.StatusCode -lt 300
    }
    catch {
        return $false
    }
}

function Wait-ForHttpOk {
    param(
        [string]$Name,
        [string]$Url,
        [int]$Attempts = 40
    )

    for ($Attempt = 1; $Attempt -le $Attempts; $Attempt++) {
        if (Test-HttpOk $Url) {
            Write-Host "$Name is ready at $Url" -ForegroundColor Green
            return
        }
        Start-Sleep -Seconds 1
    }

    throw "$Name did not become ready at $Url. Keep the $Name window open and check its error output."
}

function Wait-ForDockerDatabase {
    $Ready = $false
    for ($Attempt = 1; $Attempt -le 30; $Attempt++) {
        docker compose exec -T db pg_isready -U duty_rota -d duty_rota *> $null
        if ($LASTEXITCODE -eq 0) {
            $Ready = $true
            break
        }
        Start-Sleep -Seconds 1
    }

    if (-not $Ready) {
        throw "PostgreSQL did not become ready in time."
    }
}

Write-Host "Starting Duty Rota Software..." -ForegroundColor Cyan

if (-not (Test-Path $BackendPython)) {
    Write-Host "Creating backend virtual environment..." -ForegroundColor Yellow
    Set-Location $Backend
    Invoke-NativeCommand "Could not create backend virtual environment." { python -m venv .venv }
}

Write-Host "Checking backend dependencies..." -ForegroundColor Yellow
if (-not (Test-BackendDependencies)) {
    Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
    Set-Location $Backend
    Invoke-NativeCommand "Could not install backend dependencies." {
        & $BackendPython -m pip install -e ".[dev]" --disable-pip-version-check
    }
}

if (-not (Test-Path $FrontendNodeModules)) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    Set-Location $Frontend
    Invoke-NativeCommand "Could not install frontend dependencies." { npm install }
}

Set-Location $Root
if (Test-DatabaseConnection) {
    Write-Host "PostgreSQL is already running and linked." -ForegroundColor Green
}
elseif (Get-Command docker -ErrorAction SilentlyContinue) {
    try {
        Write-Host "Starting PostgreSQL database..." -ForegroundColor Yellow
        Invoke-NativeCommand "Could not start Docker PostgreSQL." { docker compose up -d db }
        Wait-ForDockerDatabase
        Write-Host "PostgreSQL is ready." -ForegroundColor Green
    }
    catch {
        Write-Host "Could not start Docker PostgreSQL. Make sure local PostgreSQL is running on localhost:5432." -ForegroundColor Yellow
    }
}
else {
    throw "PostgreSQL is not reachable and Docker was not found. Start local PostgreSQL on localhost:5432, or install Docker Desktop."
}

Write-Host "Applying database migrations..." -ForegroundColor Yellow
Set-Location $Backend
Invoke-NativeCommand "Could not apply database migrations. Check that PostgreSQL is running and DATABASE_URL is correct." {
    & $BackendPython -m alembic upgrade head
}

Write-Host "Launching backend at $BackendUrl" -ForegroundColor Green
Start-DutyRotaProcess `
    -Title "Duty Rota Backend" `
    -WorkingDirectory $Backend `
    -Command ".\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000"

Wait-ForHttpOk -Name "Backend" -Url "$BackendUrl/api/health"

Write-Host "Launching frontend at $FrontendUrl" -ForegroundColor Green
Start-DutyRotaProcess `
    -Title "Duty Rota Frontend" `
    -WorkingDirectory $Frontend `
    -Command "npm run dev -- --host 127.0.0.1 --port 5173"

Wait-ForHttpOk -Name "Frontend" -Url $FrontendUrl

if (-not $SkipBrowser) {
    Start-Process $FrontendUrl
}

Set-Location $Root
Write-Host ""
Write-Host "Duty Rota is starting. Keep the two opened PowerShell windows running." -ForegroundColor Cyan
Write-Host "Open $FrontendUrl in your browser." -ForegroundColor Cyan
