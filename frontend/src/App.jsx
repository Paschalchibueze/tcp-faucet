import { useState, useRef, useCallback, useEffect } from 'react';
import HCaptcha from '@hcaptcha/react-hcaptcha';
import './App.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const HCAPTCHA_SITE_KEY = import.meta.env.VITE_HCAPTCHA_SITE_KEY || '';

// ── CONFIRMED TOKEN DETAILS ────────────────────────────────────────────────
const TOKEN = {
  name:            'CrypticalPTestToken',
  symbol:          'TCP',
  contractAddress: '0xE9E3e39E91f51060318C0d46Be823fF387165A72',
  decimals:        18,
  network:         'BNB Smart Chain Testnet',
  chainId:         '97',
  rpcUrl:          'https://bsc-testnet-dataseed.bnbchain.org',
  explorerBase:    'https://testnet.bscscan.com',
};

// ── SECURITY HELPERS (unchanged from audit) ───────────────────────────────
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

const SAFE_EXPLORER_ORIGIN = 'https://testnet.bscscan.com';
function isSafeExplorerUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      parsed.origin === SAFE_EXPLORER_ORIGIN &&
      parsed.protocol === 'https:' &&
      /^\/tx\/0x[0-9a-fA-F]{64}$/.test(parsed.pathname)
    );
  } catch { return false; }
}

function sanitiseMessage(msg) {
  if (typeof msg !== 'string') return 'An unexpected error occurred.';
  return msg.replace(/<[^>]*>/g, '').slice(0, 300);
}

// ── STATUS CONSTANTS ───────────────────────────────────────────────────────
const STATUS = { IDLE: 'idle', LOADING: 'loading', SUCCESS: 'success', ERROR: 'error' };

function truncateTx(tx) {
  if (!tx || tx.length < 10) return tx;
  return `${tx.slice(0, 10)}...${tx.slice(-8)}`;
}

// ── COPY BUTTON COMPONENT ──────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button className="copy-btn" onClick={handleCopy} title="Copy to clipboard" type="button">
      {copied ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2"/>
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
        </svg>
      )}
    </button>
  );
}

// ── STATIC CONTENT DATA ────────────────────────────────────────────────────
const networkConfig = [
  { label: 'Network Name',    value: 'BNB Smart Chain Testnet',                    copy: true  },
  { label: 'Chain ID',        value: TOKEN.chainId,                                copy: true  },
  { label: 'RPC URL',         value: TOKEN.rpcUrl,                                 copy: true  },
  { label: 'Block Explorer',  value: 'testnet.bscscan.com',                        copy: false },
  { label: 'Currency Symbol', value: 'tBNB',                                       copy: false },
];

const tokenDetails = [
  { label: 'Token Name',        value: TOKEN.name,            copy: false, link: null },
  { label: 'Token Symbol',      value: TOKEN.symbol,          copy: false, link: null },
  { label: 'Contract Address',  value: TOKEN.contractAddress, copy: true,  link: `${TOKEN.explorerBase}/token/${TOKEN.contractAddress}` },
  { label: 'Decimals',          value: String(TOKEN.decimals),copy: false, link: null },
  { label: 'Network',           value: TOKEN.network,         copy: false, link: null },
];

const walletSteps = [
  {
    n: '01', title: 'Open MetaMask',
    body: 'Click the MetaMask extension in your browser or open the MetaMask mobile app. Make sure you are logged into your wallet.',
  },
  {
    n: '02', title: 'Open Network Settings',
    body: 'Click the network selector dropdown at the top of MetaMask (may show "Ethereum Mainnet"). Scroll to the bottom and click "Add network", then "Add a network manually".',
  },
  {
    n: '03', title: 'Enter BSC Testnet Details',
    body: 'Fill in the network configuration shown in the Network Configuration section on this page. Enter the Network Name, Chain ID, RPC URL, Explorer URL, and Currency Symbol exactly as shown, then click Save.',
  },
  {
    n: '04', title: 'Switch to BSC Testnet',
    body: 'Select "BNB Smart Chain Testnet" from your network list. Your wallet balance will switch to show tBNB. You are now on the correct network.',
  },
  {
    n: '05', title: 'Import TCP Token',
    body: 'Scroll down in MetaMask and click "Import tokens". Paste the TCP Contract Address shown on this page. The Symbol (TCP) and Decimals (18) should auto-fill. Click "Add custom token" then "Import tokens".',
  },
];

const faqItems = [
  {
    q: 'What is TCP used for?',
    a: 'TCP (CrypticalPTestToken) demonstrates a Freelance Payment reputation system built on BNB Smart Chain Testnet. It is a use case token implementation for testing token-based freelance payment workflows — developers can use it to validate payment logic and smart contract interactions.',
  },
  {
    q: 'How often can I claim tokens?',
    a: 'One claim of 100 TCP per wallet address every 24 hours. This limit is enforced server-side both per wallet address and per IP address to prevent abuse.',
  },
  {
    q: 'Do I need tBNB to receive TCP?',
    a: 'You do not need tBNB to receive TCP from this faucet — the faucet pays the gas. However, you will need tBNB to send TCP tokens or interact with smart contracts. Get free tBNB from the official BNB Chain testnet faucet at bnbchain.org.',
  },
  {
    q: 'Is TCP a real token with monetary value?',
    a: 'No. TCP exists only on BNB Smart Chain Testnet (Chain ID 97). Testnet tokens have zero real-world monetary value and are intended purely for development and testing purposes.',
  },
  {
    q: 'What if the faucet balance shows zero?',
    a: 'The faucet wallet holds a limited supply. If it runs out, the admin needs to top it up by sending more TCP from the main wallet. Contact the project admin if the balance is critically low.',
  },
];

// ── MAIN APP ───────────────────────────────────────────────────────────────
export default function App() {
  const [walletAddress, setWalletAddress] = useState('');
  const [captchaToken, setCaptchaToken]   = useState('');
  const [status, setStatus]               = useState(STATUS.IDLE);
  const [message, setMessage]             = useState('');
  const [txData, setTxData]               = useState(null);
  const [faucetBalance, setFaucetBalance] = useState(null);
  const [inputError, setInputError]       = useState('');
  const [openItem, setOpenItem]           = useState(null);
  const captchaRef = useRef(null);

  useEffect(() => {
    fetchWithTimeout(`${BACKEND_URL}/api/stats`)
      .then(r => r.json())
      .then(d => { if (d.faucetBalance) setFaucetBalance(Number(d.faucetBalance).toLocaleString()); })
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

  const handleCaptchaVerify  = useCallback((token) => setCaptchaToken(token), []);
  const handleCaptchaExpire  = useCallback(() => setCaptchaToken(''), []);
  const handleCaptchaError   = useCallback(() => {
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
      const res = await fetchWithTimeout(`${BACKEND_URL}/api/faucet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, hcaptchaToken: captchaToken }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const safeExplorerUrl = isSafeExplorerUrl(data.explorerUrl) ? data.explorerUrl : null;
        setStatus(STATUS.SUCCESS);
        setTxData({ ...data, explorerUrl: safeExplorerUrl });
        setMessage(sanitiseMessage(`${data.amount} TCP sent successfully.`));
        setWalletAddress('');
        fetchWithTimeout(`${BACKEND_URL}/api/stats`)
          .then(r => r.json())
          .then(d => { if (d.faucetBalance) setFaucetBalance(Number(d.faucetBalance).toLocaleString()); })
          .catch(() => {});
      } else {
        setStatus(STATUS.ERROR);
        setMessage(sanitiseMessage(data.error || 'Something went wrong. Please try again.'));
      }
    } catch (err) {
      setStatus(STATUS.ERROR);
      setMessage(err.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : 'Could not reach the faucet server. Please try again.');
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

  const toggleItem = (key) => setOpenItem(prev => prev === key ? null : key);

  const isSubmitDisabled = status === STATUS.LOADING || !walletAddress || !!inputError || !captchaToken;

  return (
    <div className="app">

      {/* ── BANNER ── */}
      <div className="banner">
        <span className="banner-dot" />
        BSC Testnet — Public Testnet · Since 2026
      </div>

      {/* ── HERO ── */}
      <header className="hero">
        <div className="hero-inner">
          <div className="hero-tag">Use Case Token</div>
          <h1 className="hero-title">
            TCP: A Use Case Token Design Implementation<br className="hero-br" />
            for Freelance Payment
          </h1>
          <p className="hero-sub">
            Distributes free test TCP tokens for testing, development, and validation<br className="hero-br" />
            of freelance payment workflows on BNB Smart Chain Testnet.
          </p>
          <div className="hero-meta">
            <span className="meta-chip"><span className="meta-dot success-dot" />Faucet Active</span>
            <span className="meta-chip">100 TCP per request</span>
            <span className="meta-chip">24 hr cooldown</span>
          </div>
        </div>
      </header>

      <main className="main">

        {/* ── FAUCET REQUEST SECTION ── */}
        <section className="section">
          <div className="faucet-layout">

            {/* Faucet form card */}
            <div className="faucet-card card">
              <div className="card-label">Request Tokens</div>

              {status !== STATUS.SUCCESS ? (
                <>
                  <div className="field">
                    <label className="field-label" htmlFor="wallet">Wallet Address</label>
                    <input
                      id="wallet"
                      type="text"
                      className={`input${inputError ? ' input-err' : ''}`}
                      placeholder="0x..."
                      value={walletAddress}
                      onChange={handleAddressChange}
                      disabled={status === STATUS.LOADING}
                      maxLength={42}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {inputError && <span className="field-error" role="alert">{inputError}</span>}
                  </div>

                  <div className="field">
                    <HCaptcha
                      ref={captchaRef}
                      sitekey={HCAPTCHA_SITE_KEY}
                      onVerify={handleCaptchaVerify}
                      onExpire={handleCaptchaExpire}
                      onError={handleCaptchaError}
                      theme="light"
                    />
                    {!captchaToken && status !== STATUS.IDLE && (
                      <span className="field-error" role="alert">Verification required</span>
                    )}
                  </div>

                  {status === STATUS.ERROR && message && (
                    <div className="alert alert-error" role="alert">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                      </svg>
                      {message}
                    </div>
                  )}

                  <button
                    className="btn-primary"
                    onClick={handleSubmit}
                    disabled={isSubmitDisabled}
                    aria-busy={status === STATUS.LOADING}
                    type="button"
                  >
                    {status === STATUS.LOADING
                      ? <><span className="spinner" />Sending Transaction...</>
                      : <>Request 100 TCP</>
                    }
                  </button>
                </>
              ) : (
                <div className="success-panel">
                  <div className="success-badge">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                  <div className="success-title">{message}</div>
                  {txData && (
                    <div className="tx-box">
                      <div className="tx-row">
                        <span className="tx-key">Amount</span>
                        <span className="tx-val bold">{txData.amount} TCP</span>
                      </div>
                      <div className="tx-row">
                        <span className="tx-key">Transaction</span>
                        {txData.explorerUrl ? (
                          <a className="tx-link" href={txData.explorerUrl} target="_blank" rel="noopener noreferrer">
                            {truncateTx(txData.txHash)} ↗
                          </a>
                        ) : (
                          <span className="tx-val mono">{truncateTx(txData.txHash)}</span>
                        )}
                      </div>
                    </div>
                  )}
                  <button className="btn-secondary" onClick={handleReset} type="button">
                    Make Another Request
                  </button>
                </div>
              )}
            </div>

            {/* Stats sidebar */}
            <div className="stats-col">
              <div className="stat-card card">
                <div className="stat-label">Amount per request</div>
                <div className="stat-value">100 TCP</div>
              </div>
              <div className="stat-card card">
                <div className="stat-label">Request cooldown</div>
                <div className="stat-value">24 hours</div>
              </div>
              <div className="stat-card card">
                <div className="stat-label">Faucet balance</div>
                <div className="stat-value">{faucetBalance !== null ? `${faucetBalance}` : '—'}</div>
              </div>
              <div className="stat-card card">
                <div className="stat-label">Network</div>
                <div className="stat-value small">BSC Testnet</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── NETWORK CONFIGURATION ── */}
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Network Configuration</h2>
            <p className="section-sub">Add BNB Smart Chain Testnet to your MetaMask or compatible wallet</p>
          </div>
          <div className="card config-grid">
            {networkConfig.map(item => (
              <div className="config-row" key={item.label}>
                <span className="config-label">{item.label}</span>
                <div className="config-val-wrap">
                  <span className="config-value">{item.value}</span>
                  {item.copy && <CopyButton text={item.value} />}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── TCP TOKEN DETAILS ── */}
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">TCP Token Details</h2>
            <p className="section-sub">Import CrypticalPTestToken into your wallet using these details</p>
          </div>
          <div className="card config-grid">
            {tokenDetails.map(item => (
              <div className="config-row" key={item.label}>
                <span className="config-label">{item.label}</span>
                <div className="config-val-wrap">
                  {item.link ? (
                    <a className="config-link" href={item.link} target="_blank" rel="noopener noreferrer">
                      {item.value} ↗
                    </a>
                  ) : (
                    <span className="config-value">{item.value}</span>
                  )}
                  {item.copy && <CopyButton text={item.value} />}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── HOW TO ADD TCP — STEP GUIDE ── */}
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">How to Add TCP to Your Wallet</h2>
            <p className="section-sub">Step-by-step guide for MetaMask — takes under 2 minutes</p>
          </div>
          <div className="steps-grid">
            {walletSteps.map((step, i) => (
              <div
                key={i}
                className={`step-card card${openItem === `step-${i}` ? ' step-active' : ''}`}
                onClick={() => toggleItem(`step-${i}`)}
              >
                <div className="step-top">
                  <span className="step-num">{step.n}</span>
                  <span className="step-title">{step.title}</span>
                  <span className="step-chevron">{openItem === `step-${i}` ? '−' : '+'}</span>
                </div>
                {openItem === `step-${i}` && (
                  <div className="step-body">{step.body}</div>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">Frequently Asked Questions</h2>
            <p className="section-sub">Everything you need to know about the TCP Testnet Faucet</p>
          </div>
          <div className="faq-list">
            {faqItems.map((item, i) => (
              <div
                key={i}
                className={`faq-item card${openItem === `faq-${i}` ? ' faq-open' : ''}`}
                onClick={() => toggleItem(`faq-${i}`)}
              >
                <div className="faq-q">
                  <span>{item.q}</span>
                  <span className="faq-chevron">{openItem === `faq-${i}` ? '−' : '+'}</span>
                </div>
                {openItem === `faq-${i}` && (
                  <div className="faq-a">{item.a}</div>
                )}
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* ── FOOTER ── */}
      <footer className="footer">
        <div className="footer-inner">
          <span className="footer-left">CrypticalPTestToken (TCP) · BSC Testnet · Chain ID 97</span>
          <div className="footer-links">
            <a href={`${TOKEN.explorerBase}/token/${TOKEN.contractAddress}`} target="_blank" rel="noopener noreferrer">
              BSCScan ↗
            </a>
            <a href="https://www.bnbchain.org/en/testnet-faucet" target="_blank" rel="noopener noreferrer">
              Get tBNB ↗
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
