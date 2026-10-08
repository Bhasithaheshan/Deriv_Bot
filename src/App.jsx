import { useEffect, useRef, useState } from 'react'

const PUB = 'wss://api.derivws.com/trading/v1/options/ws/public' // market data, no login needed
const APP_ID = import.meta.env.VITE_DERIV_APP_ID
const redirectUri = () => window.location.origin + '/'
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const api = async body => {
  const r = await fetch('/api/deriv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 250))
  return j
}
const norm = a => ({ id: a.account_id || a.id || a.loginid, demo: /demo|virtual/i.test(JSON.stringify(a)), bal: a.balance, cur: a.currency })
const MARKETS = { 'Volatility 10 (1s)': '1HZ10V', 'Volatility 25 (1s)': '1HZ25V', 'Volatility 50 (1s)': '1HZ50V', 'Volatility 75 (1s)': '1HZ75V', 'Volatility 100 (1s)': '1HZ100V' }

function Chart({ ticks, bar }) {
  if (ticks.length < 2) return <div className="chart" />
  const vals = [...ticks, ...(bar ? [bar.high, bar.low] : [])]
  const mn = Math.min(...vals), mx = Math.max(...vals), W = 700, H = 320
  const y = v => H - ((v - mn) / (mx - mn || 1)) * (H - 20) - 10
  const x = i => (i / (ticks.length - 1)) * W
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      {bar && <rect x="0" y={y(bar.high)} width={W} height={Math.max(y(bar.low) - y(bar.high), 1)} fill="rgba(0,200,90,.15)" stroke="#0c5" />}
      <polyline fill="none" stroke="#fff" strokeWidth="1.5" points={ticks.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
    </svg>
  )
}

export default function App() {
  const [cfg, setCfg] = useState({ symbol: '1HZ100V', growth: 0.01, target: 2, wait: 0, stake: 1, maxLoss: 5, maxTrades: 20 })
  const [run, setRun] = useState(false)
  const [ticks, setTicks] = useState([])
  const [bar, setBar] = useState(null)
  const [accts, setAccts] = useState([])
  const [acct, setAcct] = useState(null)
  const [balance, setBalance] = useState(null)
  const [log, setLog] = useState([])
  const [stats, setStats] = useState({ n: 0, pnl: 0 })
  const ws = useRef(null)
  const R = useRef({ pnl: 0, n: 0, since: 999 })
  const C = useRef(cfg); C.current = cfg
  const RUN = useRef(run); RUN.current = run
  const send = o => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(o))
  const addLog = t => setLog(l => [new Date().toLocaleTimeString() + '  ' + t, ...l].slice(0, 60))

  const subscribe = () => {
    const c = C.current, r = R.current
    send({ forget_all: ['ticks', 'proposal'] })
    r.since = 999; r.bar = null; r.pid = null; setTicks([]); setBar(null)
    send({ ticks: c.symbol, subscribe: 1 })
    send({ proposal: 1, subscribe: 1, amount: +c.stake, basis: 'stake', contract_type: 'ACCU', currency: r.cur || 'USD', growth_rate: +c.growth, symbol: c.symbol })
  }

  const buy = () => {
    const r = R.current
    if (!r.pid || r.open || !r.trading) return
    r.busy = true; r.selling = false
    send({ buy: r.pid, price: +C.current.stake })
  }
  const onTick = q => {
    const r = R.current, c = C.current
    setTicks(t => [...t.slice(-79), q])
    if (r.bar && (q >= r.bar.high || q <= r.bar.low)) r.since = 0 // barrier hit
    else r.since = Math.min(r.since + 1, 999)
    const ok = RUN.current && r.trading && !r.open && !r.busy && r.pnl > -c.maxLoss && r.n < c.maxTrades
    if (ok && r.since === +c.wait) setTimeout(buy, 400) // let the fresh proposal arrive
  }
  const onPoc = p => {
    const r = R.current, c = C.current
    if (p.is_sold) {
      if (r.open !== p.contract_id) return
      r.open = null; r.busy = false; r.pnl += +p.profit; r.n++
      setStats({ n: r.n, pnl: r.pnl })
      addLog(`${p.profit >= 0 ? '✅ WIN' : '🔴 LOSS'}  ${(+p.profit).toFixed(2)}`)
      if (r.pnl <= -c.maxLoss || r.n >= c.maxTrades) { setRun(false); addLog('⏹ Limit reached — bot stopped') }
      return
    }
    if (p.tick_count >= c.target && !r.selling) { r.selling = true; send({ sell: p.contract_id, price: 0 }) }
  }
  const onMsg = e => {
    const m = JSON.parse(e.data), r = R.current
    if (m.error) { r.busy = false; addLog('❌ ' + (m.error.message || JSON.stringify(m.error))); return }
    switch (m.msg_type) {
      case 'tick': onTick(m.tick.quote); break
      case 'balance': setBalance(`${m.balance.balance} ${m.balance.currency}`); r.cur = m.balance.currency; break
      case 'proposal': {
        const d = m.proposal.contract_details || {}
        r.pid = m.proposal.id
        if (d.high_barrier) { r.bar = { high: +d.high_barrier, low: +d.low_barrier }; setBar(r.bar) }
        break
      }
      case 'buy': r.open = m.buy.contract_id; r.busy = false; addLog(`🟢 Bought #${m.buy.contract_id}`)
        send({ proposal_open_contract: 1, contract_id: m.buy.contract_id, subscribe: 1 }); break
      case 'proposal_open_contract': onPoc(m.proposal_open_contract); break
      default:
    }
  }

  const connect = (url, trading) => {
    const r = R.current
    r.url = url; r.trading = trading
    const old = ws.current; ws.current = null; old?.close()
    const s = new WebSocket(url); ws.current = s
    s.onopen = () => {
      addLog(trading ? 'Connected (trading)' : 'Connected (market data)')
      subscribe()
      if (trading) send({ balance: 1, subscribe: 1 })
    }
    s.onmessage = onMsg
    s.onclose = () => {
      if (ws.current !== s) return
      addLog('Disconnected — reconnecting…')
      if (!trading) setTimeout(() => ws.current === s && connect(PUB, false), 2000)
      else { r.trading = false; setRun(false) }
    }
    s.onerror = () => addLog('Socket error')
  }

  useEffect(() => {
    connect(PUB, false)
    const ping = setInterval(() => send({ ping: 1 }), 30000)
    return () => { clearInterval(ping); const s = ws.current; ws.current = null; s?.close() }
  }, [])

  // ---- OAuth (PKCE) ----
  const login = async (signup) => {
    if (!APP_ID) return addLog('❌ VITE_DERIV_APP_ID set karala nehe (Vercel env)')
    const v = b64(crypto.getRandomValues(new Uint8Array(32)))
    const state = b64(crypto.getRandomValues(new Uint8Array(16)))
    const ch = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
    sessionStorage.setItem('pkce', JSON.stringify({ v, state }))
    const q = new URLSearchParams({ response_type: 'code', client_id: APP_ID, redirect_uri: redirectUri(), scope: 'trade', state, code_challenge: ch, code_challenge_method: 'S256' })
    if (signup) q.set('prompt', 'registration')
    window.location.href = 'https://auth.deriv.com/oauth2/auth?' + q
  }
  const logout = () => { sessionStorage.removeItem('tok'); setAccts([]); setAcct(null); setBalance(null); setRun(false); connect(PUB, false) }

  const useAccount = async (a, tok) => {
    try {
      setAcct(a); setRun(false); setBalance(null)
      const j = await api({ action: 'otp', token: tok, accountId: a.id })
      const url = j.data?.url
      if (!url) throw new Error('OTP url nehe: ' + JSON.stringify(j).slice(0, 200))
      R.current.cur = a.cur
      connect(url, true)
    } catch (e) { addLog('❌ ' + e.message) }
  }
  const loadAccounts = async tok => {
    try {
      const j = await api({ action: 'accounts', token: tok })
      const list = (Array.isArray(j.data) ? j.data : j.data?.accounts || j.accounts || []).map(norm).filter(a => a.id)
      if (!list.length) return addLog('❌ Accounts nehe: ' + JSON.stringify(j).slice(0, 250))
      setAccts(list)
      useAccount(list.find(a => a.demo) || list[0], tok) // demo first = safer
    } catch (e) { addLog('❌ ' + e.message); sessionStorage.removeItem('tok') }
  }
  useEffect(() => {
    const p = new URLSearchParams(window.location.search), code = p.get('code')
    if (p.get('error')) addLog('❌ Login: ' + (p.get('error_description') || p.get('error')))
    if (code) {
      const saved = JSON.parse(sessionStorage.getItem('pkce') || '{}')
      window.history.replaceState({}, '', window.location.pathname)
      if (p.get('state') !== saved.state) return addLog('❌ State mismatch, login again')
      api({ action: 'token', code, verifier: saved.v, redirect_uri: redirectUri() })
        .then(j => { sessionStorage.setItem('tok', j.access_token); loadAccounts(j.access_token) })
        .catch(e => addLog('❌ Token: ' + e.message))
    } else {
      const t = sessionStorage.getItem('tok'); if (t) loadAccounts(t)
    }
  }, [])

  useEffect(() => { if (ws.current?.readyState === 1) subscribe() }, [cfg.symbol, cfg.growth, cfg.stake])

  const set = k => e => setCfg({ ...cfg, [k]: e.target.value })
  const tok = sessionStorage.getItem('tok')
  const live = acct && !acct.demo
  const trading = !!acct && R.current.trading

  return (
    <div className="wrap">
      <div className="card">
        <div className="row"><b>{Object.keys(MARKETS).find(k => MARKETS[k] === cfg.symbol)}</b><span>{ticks.at(-1)?.toFixed(2)}</span></div>
        <Chart ticks={ticks} bar={bar} />
        <div className="row"><span>Ticks since barrier hit: {R.current.since > 900 ? '-' : R.current.since}</span>
          <span>Trades {stats.n} | P/L <b className={stats.pnl >= 0 ? 'g' : 'r'}>{stats.pnl.toFixed(2)}</b></span></div>
        <div className="log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
      </div>
      <div className="card">
        {!tok ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="stop" style={{ marginTop: 0, background: 'transparent', border: '1px solid #444' }} onClick={() => login(false)}>Log in</button>
            <button style={{ marginTop: 0 }} onClick={() => login(true)}>Sign up</button>
          </div>
        ) : (
          <>
            <label>Account</label>
            <select value={acct?.id || ''} onChange={e => useAccount(accts.find(a => a.id === e.target.value), tok)}>
              {accts.map(a => <option key={a.id} value={a.id}>{a.id} {a.demo ? '(demo)' : '(REAL)'}</option>)}
            </select>
            <div className="row"><span>{live ? '🔴 REAL' : '🟢 Demo'}</span><span>{balance || '...'}</span></div>
            <button className="stop" style={{ marginTop: 8, padding: 8 }} onClick={logout}>Log out</button>
          </>
        )}
        <label>Market</label>
        <select value={cfg.symbol} onChange={set('symbol')}>{Object.entries(MARKETS).map(([n, s]) => <option key={s} value={s}>{n}</option>)}</select>
        <label>Growth rate</label>
        <select value={cfg.growth} onChange={set('growth')}>{[1, 2, 3, 4, 5].map(g => <option key={g} value={g / 100}>{g}%</option>)}</select>
        <label>Target ticks (auto-sell after N ticks)</label>
        <select value={cfg.target} onChange={set('target')}>{[1, 2, 3, 4, 5].map(t => <option key={t}>{t}</option>)}</select>
        <label>Strategy: enter after barrier hit + wait N ticks (0 = immediately)</label>
        <select value={cfg.wait} onChange={set('wait')}>{[0, 1, 2, 3, 5, 8].map(t => <option key={t}>{t}</option>)}</select>
        <label>Stake</label><input type="number" min="1" value={cfg.stake} onChange={set('stake')} />
        <label>Stop after total loss of</label><input type="number" value={cfg.maxLoss} onChange={set('maxLoss')} />
        <label>Max trades</label><input type="number" value={cfg.maxTrades} onChange={set('maxTrades')} />
        <button className={run ? 'stop' : ''} disabled={!trading}
          onClick={() => { if (!run && live && !confirm('REAL account! Start auto trading?')) return; setRun(!run) }}>
          {run ? 'Stop bot' : tok ? 'Start bot' : 'Log in to start'}
        </button>
      </div>
    </div>
  )
}
