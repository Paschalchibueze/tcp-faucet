import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { ethers } from 'ethers';

// ─── [B-06] ENV VAR VALIDATION AT STARTUP ────────────────────────────────────
// Fail fast with a clear message rather than crashing at runtime mid-request
const REQUIRED_ENV = [
  'FAUCET_PRIVATE_KEY',
  'TOKEN_CONTRACT_ADDRESS',
  'HCAPTCHA_SECRET_KEY',
];
const missingEnv = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missingEnv.length > 0) {
  console.error(`[FATAL] Missing required environment variables: ${missingEnv.join(', ')}`);
  process.exit(1);
}

// ─── [B-09] LOCK FAUCET AMOUNT AT STARTUP ────────────────────────────────────
// Parsed once at boot — runtime env tampering has zero effect after this point
const FAUCET_AMOUNT_TCP = (() => {
  const raw = process.env.FAUCET_AMOUNT_TCP || '100';
  const parsed = parseFloat(raw);
  if (isNaN(parsed) || parsed <= 0 || parsed > 10000) {
    console.error('[FATAL] FAUCET_AMOUNT_TCP must be a positive number <= 10000');
    process.exit(1);
  }
  return raw;
})();

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── [B-01] SECURITY HEADERS — OWASP A05 ────────────────────────────────────
// Sets X-Content-Type-Options, X-Frame-Options, Strict-Transport-Security,
// Content-Security-Policy, removes X-Powered-By header
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      connectSrc: ["'self'"],
    },
  },
  hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.disable('x-powered-by');

// ─── [B-07] CORS — SPLIT BY ROUTE ────────────────────────────────────────────
// /healthz: open (UptimeRobot sends no Origin header)
// /api/*:   strict whitelist — requests with NO origin are BLOCKED on API routes
const allowedOrigins = [
  process.env.FRONTEND_URL,
  ...(IS_PROD ? [] : ['http://localhost:5173', 'http://localhost:4173']),
].filter(Boolean);

const strictCors = cors({
  origin: (origin, callback) => {
    if (!origin) return callback(new Error('Origin required'));
    if (allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  optionsSuccessStatus: 200,
});

// ─── [B-03] BODY SIZE LIMIT — OWASP A04 ─────────────────────────────────────
// Faucet requests need < 300 bytes — 2kb is generous and safe
app.use(express.json({ limit: '2kb' }));

// ─── [B-02] IP-LEVEL RATE LIMITING — OWASP A04 ───────────────────────────────
// Layered on top of wallet-level limiting — bots cannot just generate new wallets
const faucetIpLimit = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1-hour window
  max: 5,                     // 5 attempts per IP per hour
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests from this IP. Try again in an hour.' },
  validate: { trustProxy: false },
});

const statsLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
});

// ─── [B-08] BOUNDED CLAIM LOG WITH PERIODIC CLEANUP ──────────────────────────
// Prevents memory exhaustion DoS via unlimited unique wallet addresses
const claimLog = new Map();
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_CLAIM_LOG_SIZE = 50_000;

setInterval(() => {
  const cutoff = Date.now() - COOLDOWN_MS;
  for (const [addr, ts] of claimLog.entries()) {
    if (ts < cutoff) claimLog.delete(addr);
  }
}, 60 * 60 * 1000);

// ─── BLOCKCHAIN SETUP ─────────────────────────────────────────────────────────
const BSC_TESTNET_RPC = 'https://bsc-testnet-dataseed.bnbchain.org';

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

let provider;
let faucetWallet;
let tokenContract;
let tokenDecimals; // cached at startup — avoids RPC call per request

async function initBlockchain() {
  provider = new ethers.JsonRpcProvider(BSC_TESTNET_RPC);
  faucetWallet = new ethers.Wallet(process.env.FAUCET_PRIVATE_KEY, provider);
  tokenContract = new ethers.Contract(
    process.env.TOKEN_CONTRACT_ADDRESS,
    ERC20_ABI,
    faucetWallet
  );
  tokenDecimals = await tokenContract.decimals();
  auditLog('SERVER_INIT', {
    wallet: faucetWallet.address,
    decimals: tokenDecimals.toString(),
    amount: FAUCET_AMOUNT_TCP,
  });
}

// ─── [B-04] HCAPTCHA VERIFICATION WITH TOKEN LENGTH GUARD ────────────────────
const HCAPTCHA_TOKEN_MAX_LEN = 2048;

async function verifyHcaptcha(token, remoteIp) {
  // Reject oversized tokens before any external network call
  if (typeof token !== 'string' || token.length > HCAPTCHA_TOKEN_MAX_LEN) {
    return false;
  }

  const params = new URLSearchParams({
    secret: process.env.HCAPTCHA_SECRET_KEY,
    response: token,
    ...(remoteIp && { remoteip: remoteIp }),
  });

  const res = await fetch('https://api.hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
    signal: AbortSignal.timeout(5000), // hard 5s timeout on external call
  });

  if (!res.ok) throw new Error('hCaptcha API unreachable');
  const data = await res.json();
  return data.success === true;
}

// ─── [B-05] STRICT INPUT VALIDATION — OWASP A03 ──────────────────────────────
function isValidAddress(address) {
  if (typeof address !== 'string') return false;
  if (address.length !== 42) return false;
  try {
    ethers.getAddress(address); // EIP-55 checksum validation — throws on invalid
    return true;
  } catch {
    return false;
  }
}

// ─── [B-10] STRUCTURED AUDIT LOGGING — OWASP A09 ────────────────────────────
function auditLog(event, data = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// /healthz — intentionally open, no CORS restriction (UptimeRobot has no Origin)
app.get('/healthz', (_req, res) => res.status(200).json({ status: 'ok' }));

// /api/stats — CORS + light rate limit
app.get('/api/stats', strictCors, statsLimit, async (_req, res) => {
  try {
    const balance = await tokenContract.balanceOf(faucetWallet.address);
    const formatted = ethers.formatUnits(balance, tokenDecimals);
    res.json({ faucetBalance: formatted });
  } catch (err) {
    auditLog('STATS_ERROR', { error: err.message });
    res.status(500).json({ error: 'Could not fetch faucet balance' });
  }
});

// /api/faucet — full security stack
app.post('/api/faucet', strictCors, faucetIpLimit, async (req, res) => {
  const body = req.body ?? {};
  const { walletAddress, hcaptchaToken } = body;

  // 1. Presence check
  if (!walletAddress || !hcaptchaToken) {
    return res.status(400).json({ error: 'walletAddress and hcaptchaToken are required' });
  }

  // 2. [B-05] Strict type enforcement — reject non-strings outright
  if (typeof walletAddress !== 'string' || typeof hcaptchaToken !== 'string') {
    return res.status(400).json({ error: 'Invalid input types' });
  }

  // 3. Address format validation — EIP-55 checksum via ethers
  if (!isValidAddress(walletAddress)) {
    return res.status(400).json({ error: 'Invalid wallet address format' });
  }

  const normalizedAddress = walletAddress.toLowerCase();

  // 4. Wallet-level 24-hour cooldown
  const lastClaim = claimLog.get(normalizedAddress);
  if (lastClaim) {
    const elapsed = Date.now() - lastClaim;
    if (elapsed < COOLDOWN_MS) {
      const remainingHrs = Math.ceil((COOLDOWN_MS - elapsed) / (1000 * 60 * 60));
      auditLog('RATE_LIMITED_WALLET', { address: normalizedAddress, remainingHrs });
      return res.status(429).json({
        error: `This wallet already claimed tokens. Try again in ${remainingHrs} hour(s).`,
      });
    }
  }

  // [B-08] Hard ceiling on map size
  if (!claimLog.has(normalizedAddress) && claimLog.size >= MAX_CLAIM_LOG_SIZE) {
    auditLog('CLAIM_LOG_CEILING', { size: claimLog.size });
    return res.status(503).json({ error: 'Faucet is temporarily unavailable. Try later.' });
  }

  // 5. hCaptcha server-side verification — cannot be skipped by frontend
  let captchaPassed;
  try {
    const remoteIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    captchaPassed = await verifyHcaptcha(hcaptchaToken, remoteIp);
  } catch (err) {
    auditLog('CAPTCHA_SERVICE_ERROR', { error: err.message });
    return res.status(500).json({ error: 'CAPTCHA service error. Try again.' });
  }

  if (!captchaPassed) {
    auditLog('CAPTCHA_FAILED', { address: normalizedAddress });
    return res.status(400).json({ error: 'CAPTCHA verification failed. Please try again.' });
  }

  // 6. Send TCP tokens
  try {
    const amount = ethers.parseUnits(FAUCET_AMOUNT_TCP, tokenDecimals);
    const tx = await tokenContract.transfer(walletAddress, amount);

    claimLog.set(normalizedAddress, Date.now());

    auditLog('TOKEN_SENT', {
      to: normalizedAddress,
      amount: FAUCET_AMOUNT_TCP,
      txHash: tx.hash,
    });

    return res.status(200).json({
      success: true,
      txHash: tx.hash,
      amount: FAUCET_AMOUNT_TCP,
      explorerUrl: `https://testnet.bscscan.com/tx/${tx.hash}`,
    });
  } catch (err) {
    auditLog('TRANSFER_ERROR', { address: normalizedAddress, code: err.code });
    if (err.code === 'INSUFFICIENT_FUNDS') {
      return res.status(503).json({ error: 'Faucet wallet is out of tBNB gas. Contact admin.' });
    }
    return res.status(500).json({ error: 'Token transfer failed. Please try again later.' });
  }
});

// ─── 404 HANDLER ──────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ─── GLOBAL ERROR HANDLER — never leaks stack traces ─────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.message === 'Not allowed by CORS' || err.message === 'Origin required') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  auditLog('UNHANDLED_ERROR', { error: err.message });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── START ────────────────────────────────────────────────────────────────────
initBlockchain()
  .then(() => {
    app.listen(PORT, () => auditLog('SERVER_START', { port: PORT }));
  })
  .catch((err) => {
    console.error('[FATAL] Blockchain init failed:', err.message);
    process.exit(1);
  });
