# Deployment Documentation — Build Secure 24

## Overview

This directory contains deployment configuration and deployment records for **MarketHub — Secure Multi-Vendor Marketplace**.

- **Application Stack:** Node.js 24 + Express + Native `node:sqlite` + EJS + Helmet + Bcrypt
- **Container Definition:** [`deployment/Dockerfile`](Dockerfile)
- **Infrastructure-as-Code Blueprint:** [`deployment/render.yaml`](render.yaml)

---

## Live Deployment Reference

- **Live Application URL:** https://markethub-production.onrender.com *(Update with final live URL upon cloud push)*
- **Hosting Platform:** Render / Docker Container Cloud
- **Health Check Endpoint:** `/health`
- **Access Credentials (for Evaluator Role Verification):**
  - All accounts use the shared demo password: `Password123!`
  
| Role | Email Account | Password | Primary Capabilities |
|------|---------------|----------|----------------------|
| **Admin** | `admin@markethub.local` | `Password123!` | User moderation, status toggle, product delisting, security audit logs |
| **Vendor 1** | `vendor@markethub.local` | `Password123!` | Product CRUD, image uploads, vendor sales metrics, vendor orders |
| **Vendor 2** | `vendor2@markethub.local` | `Password123!` | Used for cross-vendor IDOR isolation testing |
| **Customer** | `customer@markethub.local` | `Password123!` | Browse, search, filter, shopping cart, mock checkout, order history |

---

## Required Environment Variables

All environment configurations are isolated from application code via `.env`:

| Variable Name | Description | Required | Default / Example |
|---------------|-------------|----------|-------------------|
| `PORT` | Listening HTTP port | No | `3000` |
| `NODE_ENV` | Runtime environment mode | Yes | `production` |
| `SESSION_SECRET` | 32+ character high-entropy key for HMAC session signing | Yes | Random cryptographic string |
| `DB_PATH` | Path to persistent SQLite database file | Yes | `./src/database/markethub.db` |
| `RATE_LIMIT_WINDOW_MS` | Rate limiting evaluation window in milliseconds | No | `900000` (15 mins) |
| `RATE_LIMIT_MAX` | Maximum allowed requests per IP window | No | `100` |
| `AUTH_RATE_LIMIT_MAX` | Maximum login/registration attempts per window | No | `15` |

---

## Local Launch Instructions

To launch and run the application locally on your workstation:

```bash
# 1. Install dependencies
npm install

# 2. Run security and functional test verification suite
npm test

# 3. Start local development server
npm start
# -> Access marketplace at http://localhost:3000
# -> Health check endpoint at http://localhost:3000/health
```

---

## Cloud Deployment Guide (Render)

1. Push your repository to your team's GitHub repository:
   ```bash
   git push -u origin main
   ```
2. Log in to [Render.com](https://render.com) and click **New + > Web Service**.
3. Select your GitHub repository (`MarketHub`).
4. Set:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node src/server.js`
   - **Health Check Path:** `/health`
5. In **Environment Variables**, set:
   - `NODE_ENV`: `production`
   - `SESSION_SECRET`: *(Generate a secure random string)*
6. Click **Deploy Web Service**.
7. Once live, copy your public URL and record it in `metadata/submission.yaml` and this document.
