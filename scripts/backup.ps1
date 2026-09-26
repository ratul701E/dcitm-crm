# ==============================================================================
# DCITM CRM — Instant Database Backup Helper (PowerShell)
# ==============================================================================
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir

Set-Location $RootDir

Write-Host "==> [DCITM CRM] Triggering immediate PostgreSQL backup..." -ForegroundColor Cyan

# Execute backup inside db-backup container
docker compose exec db-backup /backup.sh

Write-Host "`n==> [DCITM CRM] Backup process finished!" -ForegroundColor Green
Write-Host "==> Stored in: $RootDir\backups\postgres" -ForegroundColor Cyan

if (Test-Path "$RootDir\backups\postgres") {
    Get-ChildItem -Path "$RootDir\backups\postgres" | Select-Object Name, Length, LastWriteTime | Format-Table -AutoSize
}
