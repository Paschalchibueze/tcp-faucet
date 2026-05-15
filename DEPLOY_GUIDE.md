# TCP Faucet — Deployment Guide
**CrypticalPTestToken (TCP) · BSC Testnet · Render Free Tier**

---

## Prerequisites Before Deploying

You must have ready:
- [ ] Faucet wallet private key (dedicated wallet, NOT your main wallet)
- [ ] Faucet wallet loaded with TCP tokens and tBNB for gas
- [ ] TCP contract address (deployed and verified on BSC Testnet)
- [ ] hCaptcha site key + secret key from dashboard.hcaptcha.com
- [ ] GitHub account with this project pushed as a repository

---

## Step 1 — Push to GitHub

Your repo should have this structure:
```
tcp-faucet/
├── backend/
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   └── .gitignore          ← must include .env
└── frontend/
    ├── src/
    │   ├── App.jsx
    │   ├── App.css
    │   ├── main.jsx
    │   └── index.css
    ├── index.html
    ├── package.json
    ├── vite.config.js
    ├── .env.example
    └── .gitignore          ← must include .env and dist/
```

**CRITICAL: Confirm your .env files are NOT in git before pushing:**
```bash
git status
# .env should NOT appear in the list
```

If .env appears: `echo ".env" >> .gitignore && git rm --cached .env`

---

## Step 2 — Deploy the Backend on Render

1. Go to https://render.com → Sign up free (no credit card needed)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub account → select your `tcp-faucet` repository
4. Configure the service:

| Field | Value |
|---|---|
| Name | `tcp-faucet-backend` |
| Root Directory | `backend` |
| Environment | `Node` |
| Build Command | `npm install` |
| Start Command | `node server.js` |
| Instance Type | **Free** |

5. Click **"Advanced"** → **"Add Environment Variable"** → add ALL of these:

| Key | Value |
|---|---|
| `FAUCET_PRIVATE_KEY` | Your faucet wallet private key |
| `TOKEN_CONTRACT_ADDRESS` | Your deployed TCP contract address |
| `HCAPTCHA_SECRET_KEY` | Your hCaptcha secret key |
| `FAUCET_AMOUNT_TCP` | `100` |
| `FRONTEND_URL` | Leave blank for now — update after Step 3 |

6. Click **"Create Web Service"**
7. Wait for deployment (~2 minutes)
8. Copy the backend URL — looks like: `https://tcp-faucet-backend.onrender.com`
9. Go back to Environment Variables → add `FRONTEND_URL` → paste your frontend URL (once deployed)

---

## Step 3 — Deploy the Frontend on Render

1. Click **"New +"** → **"Static Site"**
2. Select the same `tcp-faucet` repository
3. Configure:

| Field | Value |
|---|---|
| Name | `tcp-faucet-frontend` |
| Root Directory | `frontend` |
| Build Command | `npm install && npm run build` |
| Publish Directory | `frontend/dist` |

4. Click **"Advanced"** → **"Add Environment Variable"**:

| Key | Value |
|---|---|
| `VITE_BACKEND_URL` | Your backend URL from Step 2 |
| `VITE_HCAPTCHA_SITE_KEY` | Your hCaptcha site key (public key) |

5. Click **"Create Static Site"**
6. Copy the frontend URL — looks like: `https://tcp-faucet-frontend.onrender.com`
7. Go back to backend → update `FRONTEND_URL` environment variable with this URL
8. Trigger a manual redeploy of the backend so CORS picks up the new URL

---

## Step 4 — Add Your Render Domain to hCaptcha

Your hCaptcha sitekey is locked to specific domains.

1. Go to https://dashboard.hcaptcha.com
2. Click your site → **Settings**
3. Under **"Domains"** → add: `tcp-faucet-frontend.onrender.com`
4. Save

Without this, the CAPTCHA widget will not load on your live site.

---

## Step 5 — Set Up UptimeRobot (Keep-Alive)

Render's free tier sleeps after 15 minutes of inactivity. This fixes it for free.

1. Go to https://uptimerobot.com → Sign up free
2. Click **"Add New Monitor"**
3. Configure:

| Field | Value |
|---|---|
| Monitor Type | HTTP(s) |
| Friendly Name | TCP Faucet Backend |
| URL | `https://your-backend.onrender.com/healthz` |
| Monitoring Interval | Every 5 minutes |

4. Save — UptimeRobot now pings your backend every 5 minutes forever.

---

## Step 6 — Test the Live Faucet

1. Open your frontend URL in a browser
2. Enter a BSC Testnet wallet address (different from your faucet wallet)
3. Complete the hCaptcha
4. Click "Request 100 TCP"
5. Confirm the tx hash appears and links correctly on testnet.bscscan.com
6. Try submitting again with the same wallet — confirm the 24-hour rate limit error appears

---

## Step 7 — Push Final Code to GitHub

```bash
# From the root of your project
git add .
git commit -m "feat: add TCP faucet frontend and backend"
git push origin main
```

---

## Environment Variables Reference

### Backend (.env / Render Environment)
| Variable | Description | Secret? |
|---|---|---|
| `FAUCET_PRIVATE_KEY` | Faucet wallet private key |  YES — never expose |
| `TOKEN_CONTRACT_ADDRESS` | TCP contract address on BSC Testnet | No |
| `HCAPTCHA_SECRET_KEY` | hCaptcha server-side secret |  YES — never expose |
| `FAUCET_AMOUNT_TCP` | TCP to send per request (default: 100) | No |
| `FRONTEND_URL` | Your frontend Render URL (for CORS) | No |
| `PORT` | Set automatically by Render | No |

### Frontend (.env / Render Static Site)
| Variable | Description | Secret? |
|---|---|---|
| `VITE_BACKEND_URL` | Your backend Render URL | No |
| `VITE_HCAPTCHA_SITE_KEY` | hCaptcha public site key | No (public) |

---

## Security Notes

- `FAUCET_PRIVATE_KEY` and `HCAPTCHA_SECRET_KEY` must ONLY exist in Render environment variables — never in code or git
- The faucet wallet should only hold a small TCP supply — not the entire 100M supply
- Rate limiting is in-memory — it resets on backend restart. This is acceptable for a testnet faucet.
- If you need persistent rate limiting across restarts, the next step would be adding a free Redis instance on Render

---

## Troubleshooting

| Issue | Fix |
|---|---|
| CAPTCHA not loading on live site | Add your Render domain to hCaptcha dashboard |
| CORS error in browser | Update `FRONTEND_URL` env var in backend + redeploy backend |
| "Faucet server unreachable" | Check backend logs on Render — likely a startup error |
| "INSUFFICIENT_FUNDS" | Faucet wallet needs more tBNB for gas |
| Backend sleeping on first request | Set up UptimeRobot (Step 5) |
| Vite build fails | Confirm `VITE_BACKEND_URL` and `VITE_HCAPTCHA_SITE_KEY` are set in Render static site env vars |

### 
AUTHOR --- PACI10.