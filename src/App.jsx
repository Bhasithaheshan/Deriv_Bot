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
const MARKETS = { 'Volatility 10 Index': 'R_10', 'Volatility 25 Index': 'R_25', 'Volatility 50 Index': 'R_50', 'Volatility 75 Index': 'R_75', 'Volatility 100 Index': 'R_100' }

function Chart({ ticks, bar, hit, marks }) {
  const W = 900, H = 400, L = 8, RP = 86, T = 16, B = 26
  if (ticks.length < 2) return <div className="chart" style={{ height: 300 }} />
  const vals = ticks.map(t => t.q).concat(bar ? [bar.high, bar.low] : [])
  let mn = Math.min(...vals), mx = Math.max(...vals)
  const pad = (mx - mn || 1) * 0.08; mn -= pad; mx += pad
  const pw = W - RP, xl = L + (pw - L) * 0.8 // leave empty space on the right like Deriv
  const y = v => T + ((mx - v) / (mx - mn)) * (H - T - B)
  const n = ticks.length
  const x = i => L + (i / (n - 1)) * (xl - L)
  const last = ticks[n - 1]
  const pts = ticks.map((t, i) => `${x(i)},${y(t.q)}`).join(' ')
  const grid = [0, 1, 2, 3, 4].map(k => mn + ((mx - mn) * k) / 4)
  const tIdx = [0, 0.25, 0.5, 0.75, 1].map(f => Math.round(f * (n - 1)))
  const fmt = e => new Date(e * 1000).toLocaleTimeString([], { hour12: false })
  const Box = ({ yy, text, bg, fg }) => (
    <g>
      <rect x={pw + 4} y={yy - 10} width={RP - 8} height={20} rx={4} fill={bg} />
      <text x={pw + 4 + (RP - 8) / 2} y={yy + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill={fg}>{text}</text>
    </g>
  )
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart">
      <defs>
        <linearGradient id="fillg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity=".16" /><stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      {grid.map((g, i) => (
        <g key={i}>
          <line x1="0" x2={pw} y1={y(g)} y2={y(g)} stroke="#1f2630" />
          <text x={pw + 10} y={y(g) + 4} fontSize="11" fill="#5d6878">{g.toFixed(2)}</text>
        </g>
      ))}
      {tIdx.map((i, k) => (
        <text key={k} x={Math.min(Math.max(x(i), 30), pw - 30)} y={H - 8} textAnchor="middle" fontSize="11" fill="#5d6878">{fmt(ticks[i].t)}</text>
      ))}
      {bar && <>
        <rect x="0" y={y(bar.high)} width={pw} height={Math.max(y(bar.low) - y(bar.high), 1)} fill={hit ? 'rgba(255,60,60,.22)' : 'rgba(0,200,90,.14)'} />
        <line x1="0" x2={pw} y1={y(bar.high)} y2={y(bar.high)} stroke={hit ? '#ff4d4d' : '#12b54f'} strokeWidth={hit ? 2 : 1} />
        <line x1="0" x2={pw} y1={y(bar.low)} y2={y(bar.low)} stroke={hit ? '#ff4d4d' : '#12b54f'} strokeWidth={hit ? 2 : 1} />
      </>}
      <polygon points={`${x(0)},${H - B} ${pts} ${x(n - 1)},${H - B}`} fill="url(#fillg)" />
      <polyline fill="none" stroke="#e8eef5" strokeWidth="1.6" strokeLinejoin="round" points={pts} />
      <line x1={x(n - 1)} x2={pw} y1={y(last.q)} y2={y(last.q)} stroke="#cfd8dc" strokeWidth="1.4" />
      <circle cx={x(n - 1)} cy={y(last.q)} r="9" fill="rgba(255,255,255,.18)" />
      <circle cx={x(n - 1)} cy={y(last.q)} r="4" fill="#fff" />
      {marks.map((m, k) => {
        if (m.t < ticks[0].t - 1) return null
        const i = ticks.findIndex(t => t.t >= m.t - 0.5)
        if (i < 0) return null
        const cx = x(i), cy = y(ticks[i].q)
        return m.kind === 'buy'
          ? <circle key={k} cx={cx} cy={cy} r="6" fill="#1fd15a" stroke="#fff" strokeWidth="2" />
          : <circle key={k} cx={cx} cy={cy} r="6" fill="none" stroke={m.kind === 'win' ? '#1fd15a' : '#ff4d4d'} strokeWidth="2.5" />
      })}
      {bar && <Box yy={y(bar.high)} text={bar.high.toFixed(3)} bg="#2a9df4" fg="#fff" />}
      {bar && <Box yy={y(bar.low)} text={bar.low.toFixed(3)} bg="#2a9df4" fg="#fff" />}
      <Box yy={y(last.q)} text={last.q.toFixed(2)} bg="#fff" fg="#111" />
    </svg>
  )
}

export default function App() {
  const [cfg, setCfg] = useState({ symbol: 'R_100', growth: 0.01, target: 2, wait: 0, stake: 1, maxLoss: 5, maxTrades: 20 })
  const [run, setRun] = useState(false)
  const [ticks, setTicks] = useState([])
  const [bar, setBar] = useState(null)
  const [accts, setAccts] = useState([])
  const [acct, setAcct] = useState(null)
  const [balance, setBalance] = useState(null)
  const [log, setLog] = useState([])
  const [stats, setStats] = useState({ n: 0, pnl: 0 })
  const [streaks, setStreaks] = useState([])
  const [hit, setHit] = useState(false)
  const [marks, setMarks] = useState([])
  const ws = useRef(null)
  const R = useRef({ pnl: 0, n: 0, since: 999 })
  const C = useRef(cfg); C.current = cfg
  const RUN = useRef(run); RUN.current = run
  const send = o => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(o))
  const addLog = t => setLog(l => [new Date().toLocaleTimeString() + '  ' + t, ...l].slice(0, 60))

  const reqProposal = () => {
    const c = C.current, r = R.current
    r.pendingSub = false; r.reqAt = Date.now()
    if (!(+c.stake >= 1)) return // Deriv minimum stake is 1.00
    r.reqPending = true
    send({ proposal: 1, subscribe: 1, amount: +c.stake, basis: 'stake', contract_type: 'ACCU', currency: r.cur || 'USD', growth_rate: +c.growth, underlying_symbol: c.symbol })
  }
  // forget the old proposal stream (by id) and WAIT for the reply before opening a new one
  const flashRed = () => { const r = R.current; setHit(true); clearTimeout(r.ft); r.ft = setTimeout(() => setHit(false), 1000) }
  const addMark = (t, kind) => setMarks(ms => [...ms, { t, kind }].slice(-40))
  const subProposal = () => {
    const r = R.current
    r.pid = null; r.bar = null; setBar(null)
    if (r.pendingSub) return // already waiting for a forget reply; it will request with the latest settings
    if (r.reqPending) { r.redo = true; return } // a request is in flight; redo once it answers
    r.reqAt = Date.now()
    if (r.subId) { const id = r.subId; r.subId = null; r.pendingSub = true; send({ forget: id }) }
    else reqProposal()
  }
  const subscribe = () => {
    const c = C.current, r = R.current
    send({ forget_all: 'ticks' })
    r.since = 999; r.lastStay = null; r.hist = []; setTicks([]); setMarks([]); setStreaks([])
    send({ ticks: c.symbol, subscribe: 1 })
    subProposal()
  }

  const buy = () => {
    const r = R.current
    if (!r.pid || r.open || !r.trading || Date.now() - (r.propAt || 0) > 4000) { r.busy = false; return }
    if (r.propStake != null && r.propStake !== +C.current.stake) { r.busy = false; return } // stake changed, wait for new proposal
    r.busy = true; r.selling = false
    send({ buy: r.pid, price: r.ask || +C.current.stake })
    r.pid = null // a bought proposal id is single-use
  }
  const onTick = (q, epoch) => {
    const r = R.current, c = C.current
    setTicks(t => [...t.slice(-79), { q, t: epoch || Date.now() / 1000 }])
    r.lastT = epoch || Date.now() / 1000
    if (r.bar && Date.now() - (r.propAt || 0) < 5000 && (q >= r.bar.high || q <= r.bar.low)) flashRed()
    if (r.open) { // contract running: count ticks ourselves, sell after entry tick + target ticks
      r.inTicks = (r.inTicks || 0) + 1
      if (r.inTicks >= +c.target + 1 && !r.selling) { r.selling = true; send({ sell: r.open, price: 0 }) }
      return
    }
    const now = Date.now()
    if (now - (r.propAt || 0) > 7000 && now - (r.reqAt || 0) > 7000) subProposal() // self-heal dead proposal stream
    if (r.hasStay) return // Deriv's own streak counter drives entries (see proposal handler)
    if (r.bar && now - (r.propAt || 0) < 5000 && (q >= r.bar.high || q <= r.bar.low)) r.since = 0 // fallback detection
    else r.since = Math.min(r.since + 1, 999)
    if (r.since === +c.wait) setTimeout(maybeEnter, 400)
  }
  const maybeEnter = () => {
    const r = R.current, c = C.current
    if (RUN.current && r.trading && !r.open && !r.busy && r.pnl > -c.maxLoss && r.n < c.maxTrades && r.since === +c.wait) buy()
  }
  const onPoc = p => {
    const r = R.current, c = C.current
    if (p.is_sold) {
      if (r.open !== p.contract_id) return
      r.open = null; r.busy = false; r.pnl += +p.profit; r.n++
      setStats({ n: r.n, pnl: r.pnl })
      addMark(p.sell_time || r.lastT, p.profit >= 0 ? 'win' : 'loss')
      addLog(`${p.profit >= 0 ? '✅ WIN' : '🔴 LOSS'}  ${(+p.profit).toFixed(2)}`)
      if (r.pnl <= -c.maxLoss || r.n >= c.maxTrades) { setRun(false); addLog('⏹ Limit reached — bot stopped') }
      return
    }
  }
  const onMsg = e => {
    const m = JSON.parse(e.data), r = R.current
    if (m.error) {
      if (/not found among your open/i.test(m.error.message || '')) return // contract already closed; harmless
      if (!/already subscribed/i.test(m.error.message || '')) addLog('❌ ' + (m.error.message || JSON.stringify(m.error)))
      if (m.echo_req?.proposal) { // the proposal request itself failed
        r.reqPending = false
        if (/already subscribed/i.test(m.error.message || '')) { r.subId = null; r.pendingSub = true; send({ forget_all: 'proposal' }) }
        return
      }
      if (r.pendingSub) { reqProposal(); return }
      if (r.open) r.selling = false // retry sell on next tick
      else if (r.busy) { r.busy = false; subProposal() } // buy failed -> fresh proposal
      return
    }
    switch (m.msg_type) {
      case 'tick': onTick(m.tick.quote, m.tick.epoch); break
      case 'balance': setBalance(`${m.balance.balance} ${m.balance.currency}`); r.cur = m.balance.currency; break
      case 'proposal': {
        const d = m.proposal.contract_details || {}
        r.reqPending = false
        r.pid = m.proposal.id; r.subId = m.subscription?.id || r.subId; r.propAt = Date.now()
        r.ask = +m.proposal.ask_price || null; r.propStake = m.echo_req?.amount != null ? +m.echo_req.amount : null
        if (r.redo) { r.redo = false; subProposal(); break } // settings changed while request was in flight
        if (d.high_barrier) { r.bar = { high: +d.high_barrier, low: +d.low_barrier }; setBar(r.bar) }
        // Deriv's own "ticks stayed in" list: [current streak, previous streaks...] (same numbers as DTrader)
        if (Array.isArray(d.ticks_stayed_in) && d.ticks_stayed_in.length) {
          r.hasStay = true; r.since = +d.ticks_stayed_in[0]
          if (r.lastStay != null && r.since < r.lastStay) { r.hist = [r.lastStay, ...(r.hist || [])].slice(0, 12); flashRed() }
          r.lastStay = r.since
          setStreaks(d.ticks_stayed_in.length > 1 ? d.ticks_stayed_in.slice(0, 12).map(Number) : [r.since, ...(r.hist || [])])
          maybeEnter() // proposal is fresh right now, so buy immediately
        }
        break
      }
      case 'buy': addMark(m.buy.start_time || r.lastT, 'buy'); r.open = m.buy.contract_id; r.busy = false; r.inTicks = 0; r.selling = false; subProposal(); addLog(`🟢 Bought #${m.buy.contract_id}`)
        send({ proposal_open_contract: 1, contract_id: m.buy.contract_id, subscribe: 1 }); break
      case 'forget': case 'forget_all': if (r.pendingSub) reqProposal(); break
      case 'proposal_open_contract': onPoc(m.proposal_open_contract); break
      default:
    }
  }

  const connect = (url, trading) => {
    const r = R.current
    r.url = url; r.trading = trading; r.subId = null; r.pendingSub = false; r.reqPending = false; r.redo = false; r.pid = null; r.bar = null
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

  useEffect(() => { // debounce: don't re-subscribe on every keystroke in the stake box
    const id = setTimeout(() => { if (ws.current?.readyState === 1) subscribe() }, 700)
    return () => clearTimeout(id)
  }, [cfg.symbol, cfg.growth, cfg.stake])

  const set = k => e => setCfg({ ...cfg, [k]: e.target.value })
  const tok = sessionStorage.getItem('tok')
  const live = acct && !acct.demo
  const trading = !!acct && R.current.trading

  return (
    <div className="wrap">
      <div className="card">
        <div className="row"><b>{Object.keys(MARKETS).find(k => MARKETS[k] === cfg.symbol)}</b><span>{ticks.at(-1)?.q.toFixed(2)}</span></div>
        <Chart ticks={ticks} bar={bar} hit={hit} marks={marks} />
        <div className="row"><span>Ticks since barrier hit: {R.current.since > 900 ? '-' : R.current.since}</span>
          <span>Trades {stats.n} | P/L <b className={stats.pnl >= 0 ? 'g' : 'r'}>{stats.pnl.toFixed(2)}</b></span></div>
        {streaks.length > 0 && (
          <div className="chips"><span className="lbl">Streaks</span>
            {streaks.map((v, i) => <span key={i} className={'chip' + (i === 0 ? ' cur' : '')}>{v}</span>)}
          </div>
        )}
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
