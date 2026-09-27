# DCITM CRM — Automated CI/CD Production Deployment Guide

This guide details the automated deployment pipeline for the DCITM CRM full-stack architecture using **GitHub Actions → SSH → Google Cloud VPS → Docker Compose**.

---

## 1. Architecture & Deployment Workflow

```text
Developer Push (branch: main)
           │
           ├── Backend changes (`dcitm-crm`)
           │        ↓
           │   GitHub Actions (deploy.yml in dcitm-crm)
           │        ↓
           └── Frontend changes (`dcitm-crm-frontend`)
                    ↓
               GitHub Actions (deploy.yml in dcitm-crm-frontend)
                    │
                    ▼
           SSH into Google Cloud VPS
                    │
                    ▼
       Execute `/var/www/crm/deploy.sh [target]`
                    │
      ┌─────────────┴─────────────┐
      ▼                           ▼
[Backend Deployment]       [Frontend Deployment]
1. Record commit           1. Record commit
2. git pull main           2. git pull main
3. docker compose build    3. docker compose build
   backend                    frontend
4. docker compose up -d    4. docker compose up -d
   --no-deps backend          --no-deps frontend
5. Poll /api/health        5. Verify Nginx 200 OK
      │                           │
      └─────────────┬─────────────┘
                    ▼
         Check Status & Health
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
    [Healthy]               [Failed]
 Workflow SUCCESS        Auto-rollback to previous commit
                         Output container logs
                         Workflow FAILS
```

### Safety & Isolation Guarantees
- **PostgreSQL & Redis are never stopped or restarted** during frontend or backend deployments.
- **Zero data loss**: Destructive commands (`docker compose down`, `docker volume prune`, etc.) are never executed.
- **Selective rebuilds**: When frontend code changes, only `frontend` is rebuilt and updated. When backend code changes, only `backend` is rebuilt and updated.
- **Prisma Schema Auto-Sync**: Backend startup entrypoint runs `npx prisma db push --skip-generate` automatically.

---

## 2. One-Time VPS Setup Instructions

Run these commands on your Google Cloud VPS (as `root` or a user with `sudo` and `docker` permissions):

### Step 2.1: Verify Directory Layout
Ensure the two repositories reside side-by-side in `/var/www/crm`:
```bash
# Verify directory paths
ls -la /var/www/crm
# Expected:
# /var/www/crm/dcitm-crm           (Backend + Docker Compose)
# /var/www/crm/dcitm-crm-frontend  (Frontend React/Vite)
```

### Step 2.2: Install and Symlink the Deployment Script
Make the deployment script available at `/var/www/crm/deploy.sh`:
```bash
chmod +x /var/www/crm/dcitm-crm/scripts/deploy.sh
ln -sf /var/www/crm/dcitm-crm/scripts/deploy.sh /var/www/crm/deploy.sh
```

### Step 2.3: Generate a Dedicated Deployment SSH Key
Generate an ED25519 or 4096-bit RSA SSH key pair specifically for GitHub Actions:

```bash
# Generate key pair without passphrase
ssh-keygen -t ed25519 -C "github-actions-deploy@dcitm-crm" -f ~/.ssh/github_deploy_key -N ""

# Authorize the public key for SSH login
cat ~/.ssh/github_deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh

# Output the PRIVATE key (copy this entire output to GitHub Secrets)
cat ~/.ssh/github_deploy_key
```

> [!SECURITY TIP]
> Keep the private key (`github_deploy_key`) strictly inside GitHub Secrets. You can delete the file from the VPS once added to GitHub Secrets.

### Step 2.4: Ensure User Has Docker Permissions
Ensure the deploy user can run `docker` without `sudo`:
```bash
sudo usermod -aG docker $USER
# Test:
docker ps
```

---

## 3. GitHub Actions Secrets Configuration

In your GitHub repositories (**`ratul701E/dcitm-crm`** and **`ratul701E/dcitm-crm-frontend`**):

Navigate to: **Settings → Secrets and variables → Actions → New repository secret**

Add the following secrets:

| Secret Name | Value Example | Description |
| :--- | :--- | :--- |
| `VPS_HOST` | `34.123.45.67` | Public IP address or domain of your Google Cloud VPS |
| `VPS_USER` | `deploy` or `ubuntu` | The SSH username on the VPS |
| `VPS_SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----...` | The entire content of `~/.ssh/github_deploy_key` |
| `VPS_PORT` | `22` *(Optional)* | SSH port (defaults to `22` if omitted) |

---

## 4. How the Deployment Operates

### Automatic Triggers
- Pushing commits to `main` in `dcitm-crm` triggers `Production CI/CD Pipeline`.
  - Non-production files (markdown documentation, prettier/eslint configs) are ignored.
  - The script detects modified files and only rebuilds what changed.
- Pushing commits to `main` in `dcitm-crm-frontend` triggers `Frontend Production CD Pipeline`.
  - Rebuilds and replaces the `frontend` container without restarting backend or databases.

### Manual Trigger (`workflow_dispatch`)
You can trigger a deployment anytime from GitHub:
1. Go to **Actions** in GitHub.
2. Select **Production CI/CD Pipeline**.
3. Click **Run workflow**.
4. Choose the target:
   - `auto`: Change detection mode.
   - `backend`: Force rebuild & deploy backend.
   - `frontend`: Force rebuild & deploy frontend.
   - `all`: Force rebuild & deploy both.

---

## 5. Manual VPS Commands & Troubleshooting

You can run the deployment script directly on the VPS at any time:

```bash
# Auto-detect changes and deploy
/var/www/crm/deploy.sh auto

# Deploy backend only
/var/www/crm/deploy.sh backend

# Deploy frontend only
/var/www/crm/deploy.sh frontend

# Deploy both
/var/www/crm/deploy.sh all

# Sync/Migrate database schema (Prisma db push)
/var/www/crm/deploy.sh migrate

# Seed database with initial data
/var/www/crm/deploy.sh seed

# Check container health and git revisions
/var/www/crm/deploy.sh status
```

### Rollback
If a faulty commit was deployed, you can roll back to the previously recorded stable commit:

```bash
# Roll back backend
/var/www/crm/deploy.sh rollback backend

# Roll back frontend
/var/www/crm/deploy.sh rollback frontend
```

### Inspecting Logs
```bash
# View live backend logs
docker compose logs -f backend

# View live frontend logs
docker compose logs -f frontend

# Check container status
docker ps --filter "name=dcitm-"
```
