# Budget Tracker — Backend API

Node.js + Express + PostgreSQL backend for the eIFB Budget Tracker iOS app.  
Supports **Apple Sign In** authentication with JWT access tokens and rotating refresh tokens.

---

## Architecture Overview

```
iOS App (React Native / Capacitor)
        │
        │  HTTPS  (Bearer JWT)
        ▼
┌──────────────────────────────┐
│   Express API  (Node.js)     │
│                              │
│  /api/auth        ← Apple Sign In, token refresh
│  /api/expenses    ← CRUD expenses
│  /api/budgets     ← Monthly budget management
│  /api/categories  ← System + custom categories
└──────────┬───────────────────┘
           │  pg (node-postgres)
           ▼
┌──────────────────────────────┐
│   PostgreSQL Database        │
│                              │
│  users            refresh_tokens
│  categories       budgets
│  expenses         (monthly_spending view)
└──────────────────────────────┘
```

---

## Prerequisites

- **Node.js** 18+
- **PostgreSQL** 14+
- **Apple Developer Account** (for Sign In with Apple credentials)

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in all values — see comments in .env.example
```

### 3. Create the database
```bash
psql -U postgres -c "CREATE DATABASE budget_tracker;"
psql -U postgres -c "CREATE USER budget_user WITH PASSWORD 'your_password';"
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE budget_tracker TO budget_user;"
```

### 4. Run migrations
```bash
npm run migrate
```

### 5. Start the server
```bash
npm run dev      # development (auto-reload)
npm start        # production
```

---

## Apple Sign In Setup

### Step 1 — Apple Developer Portal
1. Go to [developer.apple.com](https://developer.apple.com) → **Certificates, Identifiers & Profiles**
2. Register an **App ID** with "Sign In with Apple" capability enabled
3. Note your **Team ID** (top right of the portal)

### Step 2 — Create a Sign In with Apple Key
1. Go to **Keys** → click **+**
2. Enable **Sign In with Apple**, click Configure, select your App ID
3. Download the `.p8` private key file — **you can only download this once**
4. Note the **Key ID**

### Step 3 — Configure .env
```
APPLE_TEAM_ID=AB12CD34EF          # From developer portal (top right)
APPLE_CLIENT_ID=com.yourapp.id    # Your app's Bundle ID
APPLE_KEY_ID=XY98ZW76VU           # From the key you just created
APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

### Step 4 — iOS App Integration
In your iOS app (Swift):
```swift
import AuthenticationServices

// Trigger Apple Sign In
let provider = ASAuthorizationAppleIDProvider()
let request  = provider.createRequest()
request.requestedScopes = [.fullName, .email]

let controller = ASAuthorizationController(authorizationRequests: [request])
controller.delegate = self
controller.presentationContextProvider = self
controller.performRequests()

// In the delegate callback, send to your API:
func authorizationController(controller:, didCompleteWithAuthorization authorization:) {
    if let credential = authorization.credential as? ASAuthorizationAppleIDCredential {
        let identityToken = String(data: credential.identityToken!, encoding: .utf8)!
        let authCode      = String(data: credential.authorizationCode!, encoding: .utf8)!
        let fullName      = credential.fullName

        // POST to your API
        APIClient.shared.signInWithApple(
            identityToken: identityToken,
            authorizationCode: authCode,
            fullName: fullName
        )
    }
}
```

---

## API Reference

All endpoints (except `/health` and `/api/auth/apple`) require:
```
Authorization: Bearer <access_token>
```

### Authentication

#### `POST /api/auth/apple`
Sign in or register with Apple.
```json
// Request
{
  "identityToken": "eyJ...",        // From ASAuthorizationAppleIDCredential
  "authorizationCode": "c_abc...",  // From ASAuthorizationAppleIDCredential
  "fullName": {                     // Only present on first sign-in — save it!
    "givenName": "Jane",
    "familyName": "Smith"
  },
  "deviceName": "Jane's iPhone 15"  // Optional, for token management
}

// Response 200
{
  "accessToken": "eyJ...",          // JWT, expires in 30 days
  "refreshToken": "a3f9...",        // Opaque token, expires in 90 days
  "user": { "id": "uuid", "email": "...", "full_name": "..." }
}
```

#### `POST /api/auth/refresh`
Exchange refresh token for a new access token (rotates refresh token).
```json
{ "refreshToken": "a3f9..." }
```

#### `POST /api/auth/logout`
Revoke the current device's refresh token.
```json
{ "refreshToken": "a3f9..." }
```

#### `POST /api/auth/logout-all`
Sign out from all devices.

#### `GET /api/auth/me`
Returns the current user's profile.

---

### Expenses

#### `GET /api/expenses?year=2026&month=3`
List expenses. Supports filtering by `year`, `month`, `category_id`. Paginated with `limit` / `offset`.

#### `POST /api/expenses`
```json
{
  "amount": 85.50,
  "category_id": "uuid",
  "expense_date": "2026-03-15",
  "note": "Groceries at Trader Joe's"
}
```

#### `GET /api/expenses/summary?year=2026&month=3`
Returns monthly totals per category + budget amounts. Powers the dashboard.
```json
{
  "year": 2026,
  "month": 3,
  "total_spent": 2125.00,
  "total_budget": 3550.00,
  "by_category": [
    {
      "category_name": "Housing",
      "total_spent": 1500.00,
      "budget": 1500.00,
      "transaction_count": 1
    }
  ]
}
```

#### `PUT /api/expenses/:id` — Update an expense
#### `DELETE /api/expenses/:id` — Delete an expense

---

### Budgets

#### `GET /api/budgets?year=2026&month=3`
Returns all budgets for the month.

#### `PUT /api/budgets`
Bulk upsert budgets for a month.
```json
{
  "year": 2026,
  "month": 3,
  "budgets": [
    { "category_id": "uuid", "amount": 1500 },
    { "category_id": "uuid", "amount": 600  }
  ]
}
```

#### `PUT /api/budgets/:category_id`
Update a single category budget.

---

### Categories

#### `GET /api/categories` — List all categories (system + custom)
#### `POST /api/categories` — Create a custom category
#### `DELETE /api/categories/:id` — Delete a custom category

---

## Deployment

### Option A — Railway (Recommended for solo projects, ~$5/month)
```bash
# Install Railway CLI
npm install -g @railway/cli
railway login
railway init
railway add --database postgresql
railway up

# Set environment variables in Railway dashboard
# Railway automatically injects DATABASE_URL — update db config to use it
```

### Option B — Render
1. Create a **Web Service** → connect your GitHub repo
2. Create a **PostgreSQL** database
3. Set all env vars in the Render dashboard
4. Deploy — Render runs `npm start` automatically

### Option C — AWS / DigitalOcean (Self-hosted)
- Use a **$6/mo DigitalOcean Droplet** (1GB RAM, plenty for this app)
- Install Node.js 18, PostgreSQL 14
- Use **PM2** to keep the server running: `pm2 start src/index.js`
- Use **Nginx** as a reverse proxy
- Use **Let's Encrypt** (certbot) for free HTTPS

---

## Security Notes

- All API keys and secrets live in `.env` — never commit this file
- Refresh tokens are stored as SHA-256 hashes, not plaintext
- Access tokens expire in 30 days; refresh tokens in 90 days
- Rate limiting is applied globally (200 req/15min) and strictly on auth (10 req/15min)
- All user data is scoped by `user_id` — users can only access their own data
- CORS restricts which origins can call the API

---

## Project Structure

```
budget-backend/
├── src/
│   ├── index.js              # Express app + middleware setup
│   ├── config/
│   │   ├── database.js       # PostgreSQL connection pool
│   │   └── logger.js         # Winston logging
│   ├── middleware/
│   │   ├── auth.js           # JWT verification middleware
│   │   └── errorHandler.js   # 404 + global error handler
│   ├── routes/
│   │   ├── auth.js           # Apple Sign In, token management
│   │   ├── expenses.js       # Expense CRUD
│   │   ├── budgets.js        # Budget management
│   │   └── categories.js     # Category management
│   └── services/
│       ├── appleAuth.js      # Apple identity token verification
│       └── tokenService.js   # JWT + refresh token logic
├── migrations/
│   ├── 001_initial_schema.sql  # Full DB schema
│   └── run.js                  # Migration runner
├── .env.example
├── package.json
└── README.md
```
