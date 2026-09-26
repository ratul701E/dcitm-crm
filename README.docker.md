# DCITM CRM — Docker & Docker Compose Deployment Guide

This guide explains how to start, configure, backup, and manage the full DCITM CRM containerized stack:
- **Frontend**: React 19 + Vite + Nginx Reverse Proxy (Port 3001)
- **Backend API**: NestJS 11 + Prisma ORM + BullMQ (Port 3000)
- **PostgreSQL 16**: Relational Database with persistent volume (Port 5432)
- **Redis 7**: Cache & Job Queue with AOF persistence (Port 6379)
- **Database Backup Service**: Automated scheduled backups with retention (`prodrigestivill/postgres-backup-local:16`)

---

## 1. Quick Start

### Step 1: Prepare Environment Configuration
Copy the Docker template file to `.env`:
```bash
# On Linux / macOS / Git Bash
cp .env.docker.example .env

# On Windows PowerShell
Copy-Item .env.docker.example .env
```
*(Customize passwords and secrets inside `.env` as required for your environment).*

### Step 2: Build and Launch All Services
```bash
docker compose up -d --build
```

### Step 3: Verify Container Health
```bash
docker compose ps
```
All services should report `healthy` or `running`.

---

## 2. Accessing the Applications

| Service | URL / Port | Details |
| :--- | :--- | :--- |
| **Frontend Web App** | [http://localhost:3001](http://localhost:3001) | Served via Nginx with SPA routing & reverse proxy |
| **Backend API** | [http://localhost:3000/api](http://localhost:3000/api) | NestJS direct HTTP port |
| **Swagger API Docs** | [http://localhost:3000/api/docs](http://localhost:3000/api/docs) or [http://localhost:3001/api/docs](http://localhost:3001/api/docs) | Interactive OpenAPI documentation |
| **PostgreSQL** | `localhost:5432` | User: `postgres`, DB: `dcitm_crm` |
| **Redis** | `localhost:6379` | Auth protected (`REDIS_PASSWORD`) |

---

## 3. Database Backup System

Automated backups run automatically on the configured schedule (default: `@daily` at 2:00 AM UTC) and save compressed `.sql.gz` files to:
```
dcitm-crm/backups/postgres/
```

### Retention Policy
Old backups are rotated automatically according to the variables set in `.env`:
- `BACKUP_KEEP_DAYS=7` (Keeps daily snapshots for 7 days)
- `BACKUP_KEEP_WEEKS=4` (Keeps weekly snapshots for 4 weeks)
- `BACKUP_KEEP_MONTHS=6` (Keeps monthly snapshots for 6 months)

### Triggering an Immediate Manual Backup
You can trigger a backup at any time without waiting for the cron job:

**Via Bash / macOS / Linux:**
```bash
./scripts/backup.sh
```

**Via PowerShell (Windows):**
```powershell
.\scripts\backup.ps1
```

**Directly via Docker:**
```bash
docker compose exec db-backup /backup.sh
```

---

## 4. Disaster Recovery & Restoring Backups

To restore a database snapshot from `backups/postgres/`:

**Via Bash / macOS / Linux:**
```bash
# Restores the latest backup found in backups/postgres/
./scripts/restore.sh

# Or restore a specific backup file
./scripts/restore.sh backups/postgres/dcitm_crm-20260926-020000.sql.gz
```

**Via PowerShell (Windows):**
```powershell
# Restores the latest backup found in backups/postgres/
.\scripts\restore.ps1

# Or restore a specific backup file
.\scripts\restore.ps1 .\backups\postgres\dcitm_crm-20260926-020000.sql.gz
```

---

## 5. Maintenance Commands

### View Logs
```bash
# View logs from all services in real time
docker compose logs -f

# View logs from a specific service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f db-backup
```

### Run Prisma Migrations / Studio
```bash
# Synchronize Prisma schema inside the running backend container
docker compose exec backend npx prisma db push

# Run database seed
docker compose exec backend npm run seed
```

### Stop / Restart Stack
```bash
# Stop containers (preserves database and cache data)
docker compose stop

# Restart containers
docker compose restart

# Completely teardown containers and network (volumes preserved)
docker compose down
```
