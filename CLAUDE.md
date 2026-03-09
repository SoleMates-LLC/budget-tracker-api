# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Node.js + Express + PostgreSQL backend API for the **eIFB Budget Tracker** iOS app. Authentication is Apple Sign In only — there is no username/password login.

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start with nodemon (auto-reload)
npm start            # Start for production
npm run migrate      # Run database migrations
npm run migrate:rollback  # Rollback migrations
```

### Database setup (first time)
```bash
psql -U postgres -c "CREATE DATABASE budget_tracker;"
psql -U postgres -c "CREATE USER budget_user WITH PASSWORD 'your_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE budget_tracker TO budget_user;"
npm run migrate
```

### Generate a JWT secret
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

## Architecture

```
src/index.js          # Express app entry point — middleware stack, route mounting
src/config/
  database.js         # pg Pool with query() and transaction() helpers
  logger.js           # Winston logger
src/middleware/
  auth.js             # JWT verification — sets req.user on protected routes
  errorHandler.js     # 404 + global error handler
src/routes/
  auth.js             # Apple Sign In, token refresh, logout, /me
  expenses.js         # Expense CRUD
  budgets.js          # Monthly budget management
  categories.js       # System + custom categories
src/services/
  appleAuth.js        # Verifies Apple identity tokens via jwks-rsa
  tokenService.js     # Issues/validates/revokes JWT access tokens and refresh tokens
migrations/
  001_initial_schema.sql  # Full DB schema + seed data
  run.js                  # Migration runner
```

## Key Design Decisions

**Token strategy:** Access tokens are JWTs (30-day expiry). Refresh tokens are 128-byte random hex strings stored as SHA-256 hashes in the DB (90-day expiry). On refresh, the old token is revoked and a new one issued (rotation). Each device gets its own refresh token row.

**Apple Sign In quirk:** Apple only sends `fullName` and `email` on the very first sign-in. Subsequent logins may have null values. The upsert in `auth.js` uses `COALESCE(EXCLUDED.field, users.field)` to avoid overwriting saved data with nulls.

**New user provisioning:** On first Apple sign-in, `provisionDefaultBudgets()` is called to seed default budget amounts for the current month across all 8 system categories.

**Database access pattern:** All routes use `db.query(sql, params)` directly — no ORM. Multi-step operations use `db.transaction(async (client) => { ... })`.

**All data is user-scoped:** Every query filters by `user_id`. Categories have a `is_system` boolean — system categories (`user_id = NULL`) are shared; custom categories belong to a user.

**Rate limiting:** Global 200 req/15min; auth endpoints 10 req/15min (enforced in `index.js` before route mounting).

## Environment Variables

Copy `.env.example` to `.env`. Required fields:
- `DB_*` — PostgreSQL connection
- `JWT_SECRET` — 64-byte random hex string
- `APPLE_TEAM_ID`, `APPLE_CLIENT_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` — from Apple Developer Portal
- `ALLOWED_ORIGINS` — comma-separated CORS origins (`DB_SSL=true` in production)

## Database Schema Summary

| Table | Key columns |
|---|---|
| `users` | `id` (UUID), `apple_user_id` (unique), `email`, `full_name` |
| `refresh_tokens` | `user_id`, `token_hash` (SHA-256), `device_name`, `expires_at`, `revoked_at` |
| `categories` | `user_id` (NULL = system), `name`, `icon`, `color`, `is_system` |
| `budgets` | `user_id`, `category_id`, `amount`, `year`, `month` — unique per combo |
| `expenses` | `user_id`, `category_id`, `amount`, `expense_date`, `note` |

`monthly_spending` is a view that aggregates expenses by user/year/month/category — used by `GET /api/expenses/summary`.
