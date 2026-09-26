# ==============================================================================
# DCITM CRM — Database Restore Helper (PowerShell)
# ==============================================================================
param(
    [Parameter(Position=0)]
    [string]$BackupFile
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$BackupDir = Join-Path $RootDir "backups\postgres"

Set-Location $RootDir

if (-not $BackupFile) {
    Write-Host "==> No backup file specified. Looking for the latest backup in $BackupDir..." -ForegroundColor Yellow
    if (Test-Path $BackupDir) {
        $latest = Get-ChildItem -Path $BackupDir -Filter "*.sql.gz" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($latest) {
            $BackupFile = $latest.FullName
        }
    }
    if (-not $BackupFile) {
        Write-Error "No .sql.gz backup files found in $BackupDir. Usage: .\scripts\restore.ps1 <path-to-backup.sql.gz>"
        exit 1
    }
}

Write-Host "`n======================================================================" -ForegroundColor Red
Write-Host "WARNING: Restoring will overwrite existing data in the database!" -ForegroundColor Red
Write-Host "Target Backup: $BackupFile" -ForegroundColor Yellow
Write-Host "======================================================================" -ForegroundColor Red

$Confirmation = Read-Host "Are you sure you want to proceed? (Type 'yes' to confirm)"
if ($Confirmation -ne "yes") {
    Write-Host "Restore cancelled." -ForegroundColor Yellow
    exit 0
}

Write-Host "==> Decompressing and restoring backup into postgres container..." -ForegroundColor Cyan

# Use docker compose to pipe decompressed stream inside the container
$insideContainerPath = "/backups/" + (Split-Path -Leaf $BackupFile)
docker compose exec -T db-backup sh -c "gunzip -c '$insideContainerPath' | psql -h postgres -U `$POSTGRES_USER -d `$POSTGRES_DB"

Write-Host "`n==> [DCITM CRM] Database successfully restored from: $BackupFile" -ForegroundColor Green
