# Project Approach & Architecture — Build Secure 24

**Team ID:** T.No-46B  
**Project Name:** MarketHub — Secure Multi-Vendor Marketplace  
**Team Size:** 2 Members  
**Primary Track / Domain:** Web Application Security & Secure E-Commerce Architecture  

---

## 1. Problem Understanding, Scope & Threat Model

### 1.1 Problem Statement & Real-World Motivation
Multi-vendor marketplaces present unique cybersecurity challenges beyond standard e-commerce platforms. In an ecosystem where untrusted third-party vendors publish listings alongside genuine merchants, traditional trust models fail. Common architectural flaws include:
- **Insecure Direct Object References (IDOR / BOLA):** Malicious vendors modifying competitor products, pricing, or viewing competitors' customer orders.
- **Cross-Site Scripting (XSS):** Stored XSS embedded inside product titles or descriptions compromising buyer session cookies.
- **SQL Injection (SQLi):** Attacking search filters or catalog queries to extract user databases.
- **Privilege Escalation:** Regular customers or vendors bypassing access controls to access administrative consoles.
- **Malicious File Uploads:** Uploading web shells disguised as product imagery to achieve remote code execution (RCE).

MarketHub implements defense-in-depth security to provide a secure marketplace accommodating Buyers, Merchants, and Platform Administrators with mutual zero-trust boundaries.

### 1.2 Target Users & Personas

| Persona | Trust Level | Capabilities & Boundaries |
|---------|-------------|----------------------------|
| **Customer (Buyer)** | Low | Browse, search, filter catalog, manage personal cart, execute mock checkout, review personal order history. Strict boundary: cannot view other buyers' orders or access vendor/admin tools. |
| **Vendor (Merchant)** | Medium-Untrusted | Self-service product publication, edit/delete *own* listings only, view fulfillment orders for *own* products. Strict boundary: zero access to competitor inventory, competitor orders, or platform users. |
| **Administrator** | High | System-wide moderation, account status toggles (active/suspended), product delisting, order monitoring, security audit log analysis. |

### 1.3 Threat Model & Attack Surface

- **Critical Assets:** User credentials, password hashes, session IDs, customer shipping addresses, product inventory counts, transactional order records, tamper-evident audit logs.
- **Potential Attack Vectors:**
  1. *Credential Stuffing / Brute Force:* Thwarted via `express-rate-limit` (15 attempts / 15 mins).
  2. *Session Hijacking / XSS:* Thwarted via `httpOnly`, `sameSite: 'lax'` cookies, Helmet Content Security Policy (CSP), and EJS contextual escaping.
  3. *Insecure Direct Object References (IDOR):* Thwarted via server-side session ownership checks (`WHERE id = ? AND vendor_id = ?`).
  4. *SQL Injection (SQLi):* 100% prepared statements with parameterized queries using native `node:sqlite`.
  5. *Unrestricted File Upload:* Thwarted via strict MIME & extension whitelist, 2MB size cap, and random hexadecimal filename rewriting.
  6. *Privilege Escalation:* Role parameter whitelisting during registration (rejecting unauthorized `admin` registrations) and server-side RBAC middleware.

---

## 2. Technical Architecture & Secure System Design

### 2.1 High-Level Architecture Overview

MarketHub is structured as a multi-tier, defense-in-depth secure web application:

```
[ Client Browser ]
        │
        ▼ (HTTPS / TLS 1.3)
[ Security Ingress Layer ]
    ├── Helmet Security Headers (CSP, Frameguard, nosniff)
    ├── Express Rate Limiters (Auth, Checkout, API)
    └── Session Handler (httpOnly, sameSite, Session Fixation Defense)
        │
        ▼
[ Application Routing & RBAC Gate ]
    ├── Public Catalog Routes (Search & Filtering)
    ├── Authenticated Customer Routes (Cart & Orders)
    ├── Vendor Center Routes (Ownership Enforced via requireRole)
    └── Admin Control Console (requireRole('admin'))
        │
        ▼
[ Controller & Domain Services Layer ]
    ├── Business Logic & Validation
    ├── Secure File Upload Filter (crypto random naming)
    └── Atomic Inventory Transaction Engine
        │
        ▼
[ Data Persistence Tier ]
    └── Native SQLite Engine (node:sqlite DatabaseSync)
        └── 100% Parameterized Prepared Statements
```

### 2.2 Data Flow & Component Interaction

1. **Ingress:** All incoming requests hit the security middleware stack first. Helmet attaches security headers; rate limiters track IP quotas.
2. **Session Verification:** `express-session` reads the encrypted `markethub.sid` cookie. If valid, the user identity is attached to `req.session.user`.
3. **Role & Ownership Gates:** 
   - Role gates (`requireRole`) inspect role claims directly from the authenticated session.
   - Ownership gates inspect resource ownership inside the controller using parameterized database queries.
4. **Execution & Auditing:** Any critical state change (login, registration, product creation, checkout, role change, or security violation) writes an immediate event to the `audit_logs` table.

### 2.3 Technology Stack Rationale

- **Runtime & Backend:** **Node.js 24 + Express 4.21**  
  *Rationale:* Modern LTS JavaScript runtime with built-in zero-dependency database capabilities, non-blocking I/O, and mature security middleware ecosystem.
- **Database Engine:** **Native `node:sqlite` (`DatabaseSync`)**  
  *Rationale:* Node 24 includes native SQLite support directly in the standard library. Eliminates brittle native C++ build tools (node-gyp/Visual Studio) while enforcing synchronous, atomic ACID transactions and parameterized prepared statements.
- **View Engine:** **EJS (Embedded JavaScript Templates)**  
  *Rationale:* Server-side rendered views guarantee contextual auto-escaping to eliminate reflected and stored XSS vulnerabilities without client-side bundle attack surface.
- **Cryptography:** **Bcrypt.js (12 Salt Rounds)**  
  *Rationale:* Proven, memory-hard key derivation function resilient against GPU-based offline dictionary attacks.
- **File Handling:** **Multer with Cryptographic Hex Renaming**  
  *Rationale:* Strips user-supplied filenames to eliminate directory traversal (`../../`) and null-byte injection.

---

## 3. Implementation Milestones & 24-Hour Timeline

| Milestone / Phase | Time Window | Key Objectives & Deliverables | Security Verification | Status |
|---|---|---|---|---|
| **Phase 1: Foundation & Build** | 0h – 6h | Scaffolding, SQLite schema, Auth, RBAC, Customer/Vendor/Admin flows, Cart, Checkout, Audit logging | 18/18 Automated Security Tests passing (`npm test`) | `Completed` |
| **Phase 2: Cloud Deployment** | 6h – 12h | Dockerfile, Render blueprint, health check endpoint, live cloud deployment | `/health` check HTTP 200 OK | `In Progress` |
| **Phase 3: Security Hardening**| 12h – 18h | IDOR penetration testing, XSS fuzzing, SQLi stress testing, session fixation audit | Automated SAST & Penetration Check | `Planned` |
| **Phase 4: Polish & Freeze** | 18h – 24h | Final documentation, live URL verification, commit SHA lock in `metadata/submission.yaml` | Submission freeze verification | `Planned` |

---

## 4. Architecture Decision Records (ADRs)

### ADR-001: Native `node:sqlite` with Prepared Statements
- **Status:** Accepted
- **Context:** Node.js 24 provides built-in `node:sqlite` with `DatabaseSync`. External SQLite packages (e.g. `better-sqlite3`, `sqlite3`) require native C++ compilers on Windows which introduce build fragility.
- **Decision:** Use native `node:sqlite` for all database persistence.
- **Security & Performance Trade-offs:** Zero external binary dependencies; 100% prepared statement enforcement guarantees immunity against SQL injection attacks.

### ADR-002: Session-based RBAC with Session Fixation Defense
- **Status:** Accepted
- **Context:** JWT tokens in `localStorage` are vulnerable to token theft via XSS.
- **Decision:** Use server-side sessions with signed `httpOnly`, `sameSite: 'lax'` cookies. On every successful login, invoke `req.session.regenerate()` to issue a brand-new session token.
- **Security & Performance Trade-offs:** Immune to XSS token theft and session fixation attacks.

### ADR-003: Cryptographic File Upload Isolation
- **Status:** Accepted
- **Context:** User-uploaded product images could contain malicious file extensions, directory traversal sequences, or excessive payloads.
- **Decision:** Implement Multer with a 2MB limit, strict MIME/extension whitelist (`jpg`, `jpeg`, `png`, `webp`), and rewrite filenames using 16 bytes of cryptographic entropy (`crypto.randomBytes(16).toString('hex')`).
- **Security & Performance Trade-offs:** Completely eliminates file overwrite and path traversal vulnerabilities.

---

## 5. Engineering Journal & Real-Time Decision Log

### [2026-10-05 12:44 IST] Entry 1: Scaffolding, Package Manifest & Environment Isolation
- **Focus:** Created `.gitignore`, `.env.example`, `.env`, and configured core security dependencies.
- **Key Challenges:** External native SQLite modules required Visual Studio C++ build tools on Windows.
- **Resolution:** Pivoted to Node.js 24's native `node:sqlite` standard library, eliminating native build dependencies.

### [2026-10-05 12:55 IST] Entry 2: Phase 1 (BUILD) Architecture & Role Implementations
- **Focus:** Complete implementation of database schema, seed accounts, security middlewares, controllers, and views for Customer, Vendor, and Admin personas.
- **Resolution:** Full end-to-end user journeys operational: registration, authentication, product browsing, cart, mock transactional checkout, vendor inventory management, admin moderation, and security audit log streaming.

---

## 6. Testing, Security Verification & Deployment Record

### 6.1 Testing & Security Verification Strategy
- **Automated Security Suite:** [`tests/security_test.js`](../tests/security_test.js) executes 18 automated unit and integration tests verifying:
  - Database schema & seed persona existence (Admin, Vendor 1, Vendor 2, Customer)
  - Bcrypt password hashing (salt rounds $\ge 12$)
  - SQL injection resistance with malicious payloads (`' OR '1'='1' --`)
  - Cross-vendor and cross-customer IDOR isolation
  - Inventory decrement transactional safety
  - Security audit log persistence
- **Static Analysis & Linting:** `npm audit` reports 0 vulnerabilities across 104 audited dependencies.

### 6.2 Deployment Verification
- **Live Deployment Platform:** Render Cloud Application Platform
- **Deployment URL:** Recorded in `deployment/README.md` and `metadata/submission.yaml`
- **Health Check Endpoint:** `/health` returning JSON service status and database connectivity
