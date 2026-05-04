import { useState, useRef, useCallback, useEffect } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const HCAPTCHA_SITE_KEY = import.meta.env.VITE_HCAPTCHA_SITE_KEY || '';

// [F-04] Fetch timeout — 15 seconds max, then surface a clear error to user
const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// [F-03] Validate explorerUrl — only allow known BSCScan testnet domain
const SAFE_EXPLORER_ORIGIN = 'https://testnet.bscscan.com';
function isSafeExplorerUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === SAFE_EXPLORER_ORIGIN &&
      parsed.protocol === 'https:' &&
      /^\/tx\/0x[0-9a-fA-F]{64}$/.test(parsed.pathname)
    );
  } catch {
    return false;
  }
}

// [F-02] Sanitise messages from backend — strip anything that is not
// plain printable ASCII/Unicode text. React already escapes JSX output,
// but this provides a defence-in-depth second layer.
function sanitiseMessage(msg) {
  if (typeof msg !== 'string') return 'An unexpected error occurred.';
  // Strip HTML tags and limit length
  return msg.replace(/<[^>]*>/g, '').slice(0, 300);
}

const STATUS = {
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
};

function truncateAddress(addr) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function truncateTx(tx) {
  if (!tx || tx.length < 10) return tx;
  return `${tx.slice(0, 10)}...${tx.slice(-8)}`;
}

export default function App() {
  const [walletAddress, setWalletAddress] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [status, setStatus] = useState(STATUS.IDLE);
  const [message, setMessage] = useState('');
  const [txData, setTxData] = useState(null);
  const [faucetBalance, setFaucetBalance] = useState(null);
  const [inputError, setInputError] = useState('');
  const captchaRef = useRef(null);

  useEffect(() => {
    // [F-04] Timeout applied to stats fetch too
    fetchWithTimeout(`${BACKEND_URL}/api/stats`)
      .then((r) => r.json())
      .then((d) => {
        if (d.faucetBalance) setFaucetBalance(Number(d.faucetBalance).toLocaleString());
      })
      .catch(() => {});
  }, []);

  const handleAddressChange = useCallback((e) => {
    const val = e.target.value.trim();
    setWalletAddress(val);
    setInputError('');
    if (val && !/^0x[0-9a-fA-F]{40}$/.test(val)) {
      setInputError('Must be a valid 0x wallet address (42 characters)');
    }
  }, []);

  const handleCaptchaVerify = useCallback((token) => setCaptchaToken(token), []);
  const handleCaptchaExpire = useCallback(() => setCaptchaToken(''), []);
  const handleCaptchaError = useCallback(() => {
    setCaptchaToken('');
    setMessage('CAPTCHA encountered an error. Please try again.');
    setStatus(STATUS.ERROR);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      setInputError('Enter a valid wallet address to continue');
      return;
    }
    if (!captchaToken) {
      setMessage('Please complete the CAPTCHA first.');
      setStatus(STATUS.ERROR);
      return;
    }

    setStatus(STATUS.LOADING);
    setMessage('');
    setTxData(null);

    try {
      // [F-04] All API calls use fetchWithTimeout
      const res = await fetchWithTimeout(`${BACKEND_URL}/api/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, hcaptchaToken: captchaToken }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        // [F-03] Validate explorerUrl before rendering as href
        const safeExplorerUrl = isSafeExplorerUrl(data.explorerUrl)
          ? data.explorerUrl
          : null;

        setStatus(STATUS.SUCCESS);
        setTxData({ ...data, explorerUrl: safeExplorerUrl });
        // [F-02] sanitiseMessage on success message too
        setMessage(sanitiseMessage(`${data.amount} TCP sent successfully.`));
        setWalletAddress('');

        fetchWithTimeout(`${BACKEND_URL}/api/stats`)
          .then((r) => r.json())
          .then((d) => {
            if (d.faucetBalance) setFaucetBalance(Number(d.faucetBalance).toLocaleString());
          })
          .catch(() => {});
      } else {
        setStatus(STATUS.ERROR);
        // [F-02] Sanitise all backend error messages before rendering
        setMessage(sanitiseMessage(data.error || 'Something went wrong. Please try again.'));
      }
    } catch (err) {
      setStatus(STATUS.ERROR);
      if (err.name === 'AbortError') {
        setMessage('Request timed out. Please try again.');
      } else {
        setMessage('Could not reach the faucet server. Please try again.');
      }
    } finally {
      captchaRef.current?.resetCaptcha();
      setCaptchaToken('');
    }
  }, [walletAddress, captchaToken]);

  const handleReset = useCallback(() => {
    setStatus(STATUS.IDLE);
    setMessage('');
    setTxData(null);
    setInputError('');
  }, []);

  const isSubmitDisabled =
    status === STATUS.LOADING ||
    !walletAddress ||
    !!inputError ||
    !captchaToken;

  return (
    <div className="app">
      <div className="noise-overlay" />

      <header className="header">
        <div className="header-inner">
          <div className="logo">
            <span className="logo-bracket">[</span>
            <span className="logo-text">TCP</span>
            <span className="logo-bracket">]</span>
          </div>
          <div className="header-meta">
            <span className="chain-badge">
              <span className="chain-dot" />
              BSC Testnet
            </span>
          </div>
        </div>
      </header>

      <main className="main">
        <section className="hero">
          <div className="hero-label">// Token Distribution System</div>
          <h1 className="hero-title">
            Cryptical<span className="accent">P</span> Faucet
          </h1>
          <p className="hero-sub">
            Request 100 TCP per wallet address every 24 hours.
            <br />
            For testing and development on BNB Smart Chain Testnet.
          </p>
        </section>

        <div className="stats-bar">
          <div className="stat">
            <span className="stat-label">DISPENSE AMOUNT</span>
            <span className="stat-value accent-text">100 TCP</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-label">COOLDOWN</span>
            <span className="stat-value">24 HRS / WALLET</span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-label">FAUCET BALANCE</span>
            <span className="stat-value">
              {faucetBalance !== null ? `${faucetBalance} TCP` : '—'}
            </span>
          </div>
          <div className="stat-divider" />
          <div className="stat">
            <span className="stat-label">NETWORK</span>
            <span className="stat-value">CHAIN ID 97</span>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Request Tokens</span>
            <span className="card-step">01 / CLAIM</span>
          </div>

          {status !== STATUS.SUCCESS ? (
            <div className="form">
              <div className="field">
                <label className="field-label" htmlFor="wallet">
                  WALLET ADDRESS
                </label>
                <div className={`input-wrap ${inputError ? 'input-error' : ''}`}>
                  <span className="input-prefix">0x</span>
                  <input
                    id="wallet"
                    type="text"
                    className="input"
                    placeholder="your BSC testnet wallet address"
                    value={walletAddress}
                    onChange={handleAddressChange}
                    disabled={status === STATUS.LOADING}
                    maxLength={42}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                {inputError && (
                  <span className="field-error" role="alert">{inputError}</span>
                )}
              </div>

              <div className="field">
                <label className="field-label">HUMAN VERIFICATION</label>
                <div className="captcha-wrap">
                  <HCaptcha
                    ref={captchaRef}
                    sitekey={HCAPTCHA_SITE_KEY}
                    onVerify={handleCaptchaVerify}
                    onExpire={handleCaptchaExpire}
                    onError={handleCaptchaError}
                    theme="dark"
                  />
                </div>
                {!captchaToken && status !== STATUS.IDLE && (
                  <span className="field-error" role="alert">CAPTCHA required</span>
                )}
              </div>

              {status === STATUS.ERROR && message && (
                <div className="alert alert-error" role="alert">
                  <span className="alert-icon">⚠</span>
                  <span>{message}</span>
                </div>
              )}

              <button
                className={`btn-primary ${status === STATUS.LOADING ? 'btn-loading' : ''}`}
                onClick={handleSubmit}
                disabled={isSubmitDisabled}
                aria-busy={status === STATUS.LOADING}
              >
                {status === STATUS.LOADING ? (
                  <>
                    <span className="spinner" />
                    Sending Transaction...
                  </>
                ) : (
                  <>
                    <span className="btn-arrow">→</span>
                    Request 100 TCP
                  </>
                )}
              </button>
            </div>
          ) : (
            <div className="success-panel">
              <div className="success-icon" aria-hidden="true">✓</div>
              <div className="success-title">{message}</div>

              {txData && (
                <div className="tx-info">
                  <div className="tx-row">
                    <span className="tx-label">AMOUNT</span>
                    <span className="tx-val accent-text">{txData.amount} TCP</span>
                  </div>
                  <div className="tx-row">
                    <span className="tx-label">TX HASH</span>
                    {/* [F-03] Only render link if URL passed validation */}
                    {txData.explorerUrl ? (
                      <a
                        className="tx-link"
                        href={txData.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {truncateTx(txData.txHash)}
                        <span className="tx-external" aria-hidden="true">↗</span>
                      </a>
                    ) : (
                      <span className="tx-val mono">{truncateTx(txData.txHash)}</span>
                    )}
                  </div>
                </div>
              )}

              <button className="btn-secondary" onClick={handleReset}>
                Request Again (24hr cooldown applies)
              </button>
            </div>
          )}
        </div>

        <div className="info-grid">
          <div className="info-card">
            <div className="info-icon" aria-hidden="true">◈</div>
            <div className="info-title">What is TCP?</div>
            <div className="info-body">
              CrypticalPTestToken is a BEP-20 token on BNB Smart Chain Testnet.
              Built with OpenZeppelin v5 — Burnable, Pausable, and Ownable2Step.
            </div>
          </div>
          <div className="info-card">
            <div className="info-icon" aria-hidden="true">◉</div>
            <div className="info-title">How it works</div>
            <div className="info-body">
              Enter your BSC Testnet wallet address, complete the CAPTCHA, and receive
              100 TCP. One claim per wallet every 24 hours.
            </div>
          </div>
          <div className="info-card">
            <div className="info-icon" aria-hidden="true">◎</div>
            <div className="info-title">Add to MetaMask</div>
            <div className="info-body">
              Network: BSC Testnet · Chain ID: 97<br />
              RPC: bsc-testnet-dataseed.bnbchain.org<br />
              Then add the TCP contract address as a custom token.
            </div>
          </div>
        </div>
      </main>

      <footer className="footer">
        <span className="mono muted">CrypticalPTestToken · BSC Testnet · Chain ID 97</span>
        <a
          className="footer-link"
          href="https://testnet.bscscan.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          BSCScan Testnet ↗
        </a>
      </footer>
    </div>
  );
}
