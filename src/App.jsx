import { useCallback, useEffect, useRef, useState } from 'react'

const PUB = 'wss://api.derivws.com/trading/v1/options/ws/public' // market data, no login needed
const APP_ID = import.meta.env.VITE_DERIV_APP_ID
const redirectUri = () => window.location.origin + '/'
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const lim = v => (+v > 0 ? +v : Infinity) // blank / 0 = no limit
const api = async body => {
  const r = await fetch('/api/deriv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(r.status + ' ' + JSON.stringify(j).slice(0, 250))
  return j
}
const norm = a => ({ id: a.account_id || a.id || a.loginid, demo: /demo|virtual/i.test(JSON.stringify(a)), bal: a.balance, cur: a.currency })
const MARKETS = { 'Volatility 10 Index': 'R_10', 'Volatility 25 Index': 'R_25', 'Volatility 50 Index': 'R_50', 'Volatility 75 Index': 'R_75', 'Volatility 100 Index': 'R_100' }

function Chart({ ticks: all, bar, hit, marks, vis, onZoom, onReset }) {
  const ref = useRef(null)
  useEffect(() => { // mouse-wheel zoom (scroll down = zoom out)
    const el = ref.current; if (!el) return
    const f = e => { e.preventDefault(); onZoom(e.deltaY > 0 ? 1 : -1) }
    el.addEventListener('wheel', f, { passive: false })
    return () => el.removeEventListener('wheel', f)
  }, [onZoom])
  const ticks = all.slice(-vis)

  const draw = () => {
    const W = 900, H = 400, L = 8, RP = 86, T = 16, B = 26
    const n = ticks.length, last = ticks[n - 1]
    let hi = null, lo = null, bd = 0 // barrier box follows the latest tick instantly (no waiting for the next proposal)
    if (bar) {
      const ctr = (bar.high + bar.low) / 2; bd = (bar.high - bar.low) / 2
      if (Math.abs(ctr - last.q) <= 1e-7 * Math.max(1, Math.abs(last.q))) { hi = bar.high; lo = bar.low }
      else { const pct = bd / ctr; hi = last.q * (1 + pct); lo = last.q * (1 - pct); bd = last.q * pct }
    }
    const vals = ticks.map(t => t.q).concat(bar ? [hi, lo] : [])
    let mn = Math.min(...vals), mx = Math.max(...vals)
    const pad = (mx - mn || 1) * 0.08; mn -= pad; mx += pad
    const m = Math.max(1, Math.sqrt(vis / 60)) // zooming out also widens the price scale
    const c = (mn + mx) / 2, half = ((mx - mn) / 2) * m; mn = c - half; mx = c + half
    const pw = W - RP, xl = L + (pw - L) * 0.8
    const y = v => T + ((mx - v) / (mx - mn)) * (H - T - B)
    const x = i => L + (i / (n - 1)) * (xl - L)
    const pts = ticks.map((t, i) => `${x(i)},${y(t.q)}`).join(' ')
    // "nice" round price levels (1 / 2 / 5 x 10^k)
    const raw = (mx - mn) / 5, pow = 10 ** Math.floor(Math.log10(raw)), f = raw / pow
    const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow
    const dec = Math.max(2, Math.ceil(-Math.log10(step)) + 1)
    const first = Math.ceil(mn / step), grid = []
    for (let k = first; k * step <= mx; k++) grid.push(k * step)
    const tIdx = [0, 0.25, 0.5, 0.75, 1].map(fr => Math.round(fr * (n - 1)))
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
          <clipPath id="plot"><rect x="0" y="0" width={pw} height={H - B} /></clipPath>
        </defs>
        {grid.map((g, i) => (
          <g key={i}>
            <line x1="0" x2={pw} y1={y(g)} y2={y(g)} stroke="#1f2630" />
            <text x={pw + 10} y={y(g) + 4} fontSize="11" fill="#5d6878">{g.toFixed(dec)}</text>
          </g>
        ))}
        {tIdx.map((i, k) => (
          <text key={k} x={Math.min(Math.max(x(i), 30), pw - 30)} y={H - 8} textAnchor="middle" fontSize="11" fill="#5d6878">{fmt(ticks[i].t)}</text>
        ))}
        <g clipPath="url(#plot)">
          {bar && (() => {
            const col = hit ? '#ff4d4d' : '#12b54f', x0 = x(n - 1), dec = bd < 1 ? 4 : 3
            return (
              <g>
                <line x1={x0} x2={x0} y1={T} y2={H - B} stroke="#2bb3a3" strokeDasharray="2 4" />
                <rect x={x0} y={y(hi)} width={Math.max(pw - x0, 1)} height={Math.max(y(lo) - y(hi), 1)} fill={hit ? 'rgba(255,60,60,.22)' : 'rgba(0,200,90,.14)'} />
                <line x1={x0} x2={pw} y1={y(hi)} y2={y(hi)} stroke={col} strokeWidth={hit ? 2 : 1.2} />
                <line x1={x0} x2={pw} y1={y(lo)} y2={y(lo)} stroke={col} strokeWidth={hit ? 2 : 1.2} />
                <circle cx={x0} cy={y(hi)} r="2.5" fill={col} /><circle cx={x0} cy={y(lo)} r="2.5" fill={col} />
                <text x={pw - 6} y={y(hi) - 6} textAnchor="end" fontSize="12" fill={col}>+{bd.toFixed(dec)}</text>
                <text x={pw - 6} y={y(lo) + 16} textAnchor="end" fontSize="12" fill={col}>-{bd.toFixed(dec)}</text>
              </g>
            )
          })()}
          <polygon points={`${x(0)},${H - B} ${pts} ${x(n - 1)},${H - B}`} fill="url(#fillg)" />
          <polyline fill="none" stroke="#e8eef5" strokeWidth="1.6" strokeLinejoin="round" points={pts} />
          <line x1={x(n - 1)} x2={pw} y1={y(last.q)} y2={y(last.q)} stroke="#cfd8dc" strokeWidth="1.4" />
          <circle cx={x(n - 1)} cy={y(last.q)} r="9" fill="rgba(255,255,255,.18)" />
          <circle cx={x(n - 1)} cy={y(last.q)} r="4" fill="#fff" />
          {marks.map((mk, k) => {
            if (mk.t < ticks[0].t - 1) return null
            const i = ticks.findIndex(t => t.t >= mk.t - 0.5)
            if (i < 0) return null
            const cx = x(i), cy = y(ticks[i].q)
            return mk.kind === 'buy'
              ? <circle key={k} cx={cx} cy={cy} r="6" fill="#1fd15a" stroke="#fff" strokeWidth="2" />
              : <circle key={k} cx={cx} cy={cy} r="6" fill="none" stroke={mk.kind === 'win' ? '#1fd15a' : '#ff4d4d'} strokeWidth="2.5" />
          })}
        </g>
        {bar && <Box yy={Math.min(Math.max(y(hi), 12), H - B - 12)} text={hi.toFixed(3)} bg="#2a9df4" fg="#fff" />}
        {bar && <Box yy={Math.min(Math.max(y(lo), 12), H - B - 12)} text={lo.toFixed(3)} bg="#2a9df4" fg="#fff" />}
        <Box yy={Math.min(Math.max(y(last.q), 12), H - B - 12)} text={last.q.toFixed(2)} bg="#fff" fg="#111" />
      </svg>
    )
  }

  return (
    <div className="chartwrap" ref={ref}>
      {ticks.length < 2 ? <div className="chart" style={{ height: 300 }} /> : draw()}
      <div className="zoom">
        <button className="zbtn" onClick={() => onZoom(1)} title="Zoom out">−</button>
        <button className="zbtn" onClick={onReset} title="Reset zoom">◎</button>
        <button className="zbtn" onClick={() => onZoom(-1)} title="Zoom in">+</button>
      </div>
    </div>
  )
}

export default function App() {
  const [cfg, setCfg] = useState({ symbol: 'R_100', growth: 0.01, target: 2, wait: 0, stake: 1, maxLoss: 5, maxProfit: 5 })
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
  const [menu, setMenu] = useState(false)   // account dropdown
  const [fail, setFail] = useState(false) // connection/login problem -> show Retry
  const [vis, setVis] = useState(60) // how many ticks the chart shows (zoom)
  const onZoom = useCallback(dir => setVis(v => Math.min(280, Math.max(12, Math.round(v * (dir > 0 ? 1.25 : 0.8))))), [])
  const onReset = useCallback(() => setVis(60), [])
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
  const withRetry = async (fn, label, tries = 4) => { // retry only on Deriv 5xx / network errors
    for (let i = 0; ; i++) {
      try { return await fn() } catch (e) {
        const msg = String(e.message || e)
        if (!(/^5\d\d/.test(msg) || /Failed to fetch|NetworkError/i.test(msg)) || i >= tries - 1) throw e
        addLog(`⏳ Deriv busy (${label}) — retry ${i + 1}/${tries - 1} in ${2 * 2 ** i}s`)
        await new Promise(res => setTimeout(res, 2000 * 2 ** i))
      }
    }
  }
  const reqTicks = () => {
    const c = C.current, r = R.current
    r.tickSym = c.symbol; r.lastSym = c.symbol; r.tickReqAt = Date.now()
    if (r.noHist) send({ ticks: c.symbol, subscribe: 1 })
    else send({ ticks_history: c.symbol, end: 'latest', count: 150, style: 'ticks', subscribe: 1 }) // history now + live ticks after
  }
  const recalcStreaks = () => {
    const r = R.current, px = r.px || []
    if (!r.pct || px.length < 2) return
    const out = []; let cur = 0
    for (let i = 1; i < px.length; i++) {
      if (Math.abs(px[i] - px[i - 1]) >= r.pct * px[i - 1] - 1e-9) { out.push(cur); cur = 0 } // barrier hit (back-to-back hits give 0)
      else cur++
    }
    out.shift() // oldest streak is cut off by the window
    r.since = cur
    setStreaks([cur, ...out.reverse()].slice(0, 12))
  }
  const flashRed = () => { const r = R.current; setHit(true); clearTimeout(r.ft); r.ft = setTimeout(() => setHit(false), 1000) }
  const addMark = (t, kind) => setMarks(ms => [...ms, { t, kind }].slice(-40))
  const subProposal = () => {
    const r = R.current
    r.pid = null; r.bar = null // keep the drawn box until the new proposal arrives (no flicker)
    if (r.pendingSub && Date.now() - (r.pendAt || 0) < 3000) return // waiting for a forget reply; it will request with the latest settings
    if (r.reqPending) { r.redo = true; return } // a request is in flight; redo once it answers
    r.reqAt = Date.now()
    if (r.subId) { const id = r.subId; r.subId = null; r.pendingSub = true; r.pendAt = Date.now(); r.pforget = id; send({ forget: id }) }
    else reqProposal()
  }
  const subscribe = () => {
    const c = C.current, r = R.current
    const key = `${c.symbol}|${c.growth}|${c.stake}`
    if (r.subKey === key) return // nothing changed -> don't spam Deriv (rate limits)
    r.subKey = key
    const gk = c.symbol + '|' + c.growth
    if (r.gk !== gk) { r.gk = gk; r.pct = null; r.lastQ = null; setBar(null) } // different market / growth rate -> different barrier
    if (r.tickSym !== c.symbol) { // market changed (or first connect on this socket)
      if (r.lastSym !== c.symbol) { r.since = 999; r.lastStay = null; r.hist = []; r.px = []; setTicks([]); setMarks([]); setStreaks([]) } // same market on a new socket: keep the chart
      if (r.ftick) { /* a forget-all is already in flight; its reply requests the latest symbol */ }
      else if (r.tickSub) { send({ forget: r.tickSub }); r.tickSub = null; reqTicks() } // different symbol: no need to wait
      else if (r.tickSym) { r.ftick = 'all'; send({ forget_all: 'ticks' }) } // old stream's id unknown
      else reqTicks()
    }
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
    if (epoch && r.lastT && epoch <= r.lastT) return // already have this tick (history overlap)
    setTicks(t => [...t.slice(-299), { q, t: epoch || Date.now() / 1000 }])
    r.lastT = epoch || Date.now() / 1000
    r.px = [...(r.px || []).slice(-299), q]; recalcStreaks()
    const prevQ = r.lastQ; r.lastQ = q
    // barrier = previous spot +/- pct, so a hit is |move| >= pct * previous price (works even before the new proposal arrives)
    if (prevQ != null && r.pct && Math.abs(q - prevQ) >= r.pct * prevQ - 1e-9) { r.lastBreakAt = Date.now(); flashRed() }
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
    if (RUN.current && r.trading && !r.open && !r.busy && r.pnl > -lim(c.maxLoss) && r.pnl < lim(c.maxProfit) && r.since === +c.wait) buy()
  }
  const onPoc = p => {
    const r = R.current, c = C.current
    if (p.is_sold) {
      if (r.open !== p.contract_id) return
      r.open = null; r.busy = false; r.pnl += +p.profit; r.n++
      setStats({ n: r.n, pnl: r.pnl })
      addMark(p.sell_time || r.lastT, p.profit >= 0 ? 'win' : 'loss')
      addLog(`${p.profit >= 0 ? '✅ WIN' : '🔴 LOSS'}  ${(+p.profit).toFixed(2)}`)
      if (r.pnl >= lim(c.maxProfit)) { setRun(false); addLog(`🎯 Profit target reached (+${r.pnl.toFixed(2)}) — bot stopped`) }
      else if (r.pnl <= -lim(c.maxLoss)) { setRun(false); addLog(`⛔ Loss limit reached (${r.pnl.toFixed(2)}) — bot stopped`) }
      return
    }
  }
  const onMsg = e => {
    const m = JSON.parse(e.data), r = R.current
    if (m.error) {
      if (/not found among your open/i.test(m.error.message || '')) return // contract already closed; harmless
      if (!/already subscribed/i.test(m.error.message || '')) addLog('❌ ' + (m.error.message || JSON.stringify(m.error)))
      if (m.echo_req?.forget && m.echo_req.forget === r.ftick) { r.ftick = null; reqTicks(); return }
      if ((m.echo_req?.ticks || m.echo_req?.ticks_history) && /already subscribed/i.test(m.error.message || '')) { r.tickSub = null; r.ftick = 'all'; send({ forget_all: 'ticks' }); return }
      if (m.echo_req?.ticks_history && !r.noHist) { r.noHist = true; reqTicks(); return } // history not available -> plain ticks
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
      case 'tick': {
        const ts = m.echo_req?.ticks || m.echo_req?.ticks_history || m.tick.symbol || m.tick.underlying_symbol
        if (ts && ts !== C.current.symbol) break // late tick from the previous market
        if (m.subscription?.id) r.tickSub = m.subscription.id
        r.lastTickAt = Date.now()
        onTick(m.tick.quote, m.tick.epoch); break
      }
      case 'history': case 'ticks_history': {
        const h = m.history
        if (!h?.prices?.length) break
        const sym = m.echo_req?.ticks_history
        if (sym && sym !== C.current.symbol) break
        if (m.subscription?.id) r.tickSub = m.subscription.id
        r.lastTickAt = Date.now()
        const arr = h.prices.map((q, i) => ({ q: +q, t: +h.times[i] }))
        r.lastT = arr[arr.length - 1].t; r.lastQ = arr[arr.length - 1].q
        r.px = arr.map(a => a.q).slice(-300); recalcStreaks()
        setTicks(arr.slice(-300))
        break
      }
      case 'balance': setBalance(`${m.balance.balance} ${m.balance.currency}`); r.cur = m.balance.currency; break
      case 'proposal': {
        const d = m.proposal.contract_details || {}
        r.reqPending = false
        r.pid = m.proposal.id; r.subId = m.subscription?.id || r.subId; r.propAt = Date.now()
        r.ask = +m.proposal.ask_price || null; r.propStake = m.echo_req?.amount != null ? +m.echo_req.amount : null
        if (r.redo) { r.redo = false; subProposal(); break } // settings changed while request was in flight
        if (d.high_barrier) { r.bar = { high: +d.high_barrier, low: +d.low_barrier }; setBar(r.bar); r.pct = (r.bar.high - r.bar.low) / (r.bar.high + r.bar.low) }
        if (r.pct) { r.hasStay = true; recalcStreaks(); maybeEnter() } // streak counted from prices; buy right away on a fresh proposal
        break
      }
      case 'buy': addMark(m.buy.start_time || r.lastT, 'buy'); r.open = m.buy.contract_id; r.busy = false; r.inTicks = 0; r.selling = false; subProposal(); addLog(`🟢 Bought #${m.buy.contract_id}`)
        send({ proposal_open_contract: 1, contract_id: m.buy.contract_id, subscribe: 1 }); break
      case 'forget': case 'forget_all': {
        const e = m.echo_req || {}
        if (e.forget_all === 'ticks' || (e.forget && e.forget === r.ftick)) { r.ftick = null; reqTicks(); break }
        if (r.pendingSub && (e.forget_all === 'proposal' || (e.forget && e.forget === r.pforget))) reqProposal()
        break
      }
      case 'proposal_open_contract': onPoc(m.proposal_open_contract); break
      default:
    }
  }

  const connect = (url, trading) => {
    const r = R.current
    r.url = url; r.trading = trading; r.subKey = null; r.tickSub = null; r.tickSym = null; r.ftick = null; r.connAt = Date.now(); r.lastTickAt = 0; r.subId = null; r.pendingSub = false; r.reqPending = false; r.redo = false; r.pid = null; r.bar = null
    const old = ws.current; ws.current = null; old?.close()
    const s = new WebSocket(url); ws.current = s
    s.onopen = () => {
      addLog(trading ? 'Connected (trading)' : 'Connected (market data)')
      r.retry = 0; if (trading) setFail(false)
      subscribe()
      if (trading) send({ balance: 1, subscribe: 1 })
    }
    s.onmessage = onMsg
    s.onclose = () => {
      if (ws.current !== s) return
      if (!trading) {
        r.retry = (r.retry || 0) + 1
        const d = Math.min(2000 * 2 ** (r.retry - 1), 30000) // back off: 2s, 4s, 8s ... 30s
        addLog(`Disconnected — reconnecting in ${d / 1000}s…`)
        setTimeout(() => ws.current === s && connect(PUB, false), d)
      } else { r.trading = false; setRun(false); setFail(true); addLog('⚠️ Trading connection lost — press Retry') }
    }
    s.onerror = () => addLog('Socket error')
  }

  useEffect(() => {
    connect(PUB, false)
    const ping = setInterval(() => send({ ping: 1 }), 30000)
    const wd = setInterval(() => { // tick stream silent for 15s -> ask again (once per 15s)
      const r = R.current, now = Date.now()
      if (ws.current?.readyState === 1 && !r.ftick && r.tickSym && now - Math.max(r.lastTickAt || 0, r.connAt || 0) > 15000 && now - (r.tickReqAt || 0) > 15000) reqTicks()
    }, 5000)
    return () => { clearInterval(ping); clearInterval(wd); const s = ws.current; ws.current = null; s?.close() }
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
      setAcct(a); setRun(false); setBalance(null); sessionStorage.setItem('acctId', a.id)
      const j = await withRetry(() => api({ action: 'otp', token: tok, accountId: a.id }), 'account')
      const url = j.data?.url
      if (!url) throw new Error('OTP url nehe: ' + JSON.stringify(j).slice(0, 200))
      R.current.cur = a.cur
      connect(url, true)
    } catch (e) { addLog('❌ ' + e.message); setFail(true) }
  }
  const retryNow = () => { setFail(false); const t = sessionStorage.getItem('tok'); if (!t) return; accts.length ? useAccount(acct || accts[0], t) : loadAccounts(t) }
  const loadAccounts = async tok => {
    let cached = null
    try { cached = JSON.parse(sessionStorage.getItem('accts') || 'null') } catch { /* ignore */ }
    const want = sessionStorage.getItem('acctId')
    if (cached?.length) { setAccts(cached); useAccount(cached.find(a => a.id === want) || cached.find(a => a.demo) || cached[0], tok) } // no waiting for the accounts call
    try {
      const j = await withRetry(() => api({ action: 'accounts', token: tok }), 'accounts')
      const list = (Array.isArray(j.data) ? j.data : j.data?.accounts || j.accounts || []).map(norm).filter(a => a.id)
      if (!list.length) return addLog('❌ Accounts nehe: ' + JSON.stringify(j).slice(0, 250))
      setAccts(list); sessionStorage.setItem('accts', JSON.stringify(list))
      if (!cached?.length) useAccount(list.find(a => a.demo) || list[0], tok) // demo first = safer
    } catch (e) {
      const msg = String(e.message || e)
      if (cached?.length && !/^40[13]/.test(msg)) return // already connected from the saved list; refresh failed silently
      if (/^40[13]/.test(msg)) { sessionStorage.removeItem('tok'); sessionStorage.removeItem('accts'); addLog('❌ Login expired — please log in again') }
      else addLog('❌ Deriv unavailable (' + msg.slice(0, 90) + ') — press Retry')
      setFail(true)
    }
  }
  useEffect(() => {
    const p = new URLSearchParams(window.location.search), code = p.get('code')
    if (p.get('error')) addLog('❌ Login: ' + (p.get('error_description') || p.get('error')))
    if (code) {
      const saved = JSON.parse(sessionStorage.getItem('pkce') || '{}')
      window.history.replaceState({}, '', window.location.pathname)
      if (p.get('state') !== saved.state) return addLog('❌ State mismatch, login again')
      withRetry(() => api({ action: 'token', code, verifier: saved.v, redirect_uri: redirectUri() }), 'login')
        .then(j => { sessionStorage.setItem('tok', j.access_token); loadAccounts(j.access_token) })
        .catch(e => { addLog('❌ Login failed: ' + String(e.message).slice(0, 120) + ' — please log in again'); setFail(true) })
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
    <div onClick={() => setMenu(false)}>
      <header className="top">
        <div className="brand">
          <img src="/logo.png" alt="" className="blogo" onError={e => { e.currentTarget.style.display = 'none' }} />
          <span className="by">By TradeXpertz</span>
        </div>
        <div className="topright" onClick={e => e.stopPropagation()}>
          {!tok ? (
            <>
              <button className="pill" onClick={() => login(false)}>Log in</button>
              <button className="pill red" onClick={() => login(true)}>Sign up</button>
            </>
          ) : (
            <>
              {acct ? <div className="acctwrap">
                <button className="acct" onClick={() => setMenu(m => !m)}>
                  <span className="acctin">
                    <span className={'alab ' + (live ? 'real' : 'demo')}>{live ? 'Real account' : 'Demo account'}</span>
                    <b>{balance || '...'}</b>
                  </span>
                  <span className="chev">⌄</span>
                </button>
                {menu && (
                  <div className="menu">
                    {accts.map(a => (
                      <button key={a.id} className={'mi' + (a.id === acct?.id ? ' sel' : '')} onClick={() => { setMenu(false); useAccount(a, tok) }}>
                        <span className={a.demo ? 'demo' : 'real'}>{a.demo ? 'Demo' : 'Real'}</span>
                        <span>{a.id}</span>
                        <b>{a.id === acct?.id ? balance : `${a.bal ?? ''} ${a.cur ?? ''}`}</b>
                      </button>
                    ))}
                  </div>
                )}
              </div> : <span className="conn">Connecting…</span>}
              {fail && <button className="pill" onClick={retryNow}>⟳ Retry</button>}
              <button className="pill" onClick={logout}>Log out</button>
            </>
          )}
        </div>
      </header>

      <div className="wrap">
        <div className="card">
          <div className="row"><b>{Object.keys(MARKETS).find(k => MARKETS[k] === cfg.symbol)}</b><span>{ticks.at(-1)?.q.toFixed(2)}</span></div>
          <Chart ticks={ticks} bar={bar} hit={hit} marks={marks} vis={vis} onZoom={onZoom} onReset={onReset} />
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
          <div className="pgrid">
            <div><label>Market</label>
              <select value={cfg.symbol} onChange={set('symbol')}>{Object.entries(MARKETS).map(([n, sy]) => <option key={sy} value={sy}>{n}</option>)}</select></div>
            <div><label>Growth rate</label>
              <select value={cfg.growth} onChange={set('growth')}>{[1, 2, 3, 4, 5].map(g => <option key={g} value={g / 100}>{g}%</option>)}</select></div>
            <div><label>Stake (USD)</label><input type="number" min="1" value={cfg.stake} onChange={set('stake')} /></div>
            <div><label>Target ticks (1-5)</label>
              <select value={cfg.target} onChange={set('target')}>{[1, 2, 3, 4, 5].map(t => <option key={t}>{t}</option>)}</select></div>
            <div><label>Stop after total loss (USD)</label><input type="number" min="0" value={cfg.maxLoss} onChange={set('maxLoss')} /></div>
            <div><label>Stop at profit (USD)</label><input type="number" min="0" value={cfg.maxProfit} onChange={set('maxProfit')} /></div>
            <div className="full"><label>Strategy: enter after barrier hit + wait N ticks (0 = immediately)</label>
              <select value={cfg.wait} onChange={set('wait')}>{[0, 1, 2, 3, 5, 8].map(t => <option key={t}>{t}</option>)}</select></div>
          </div>
          <button className={'cta' + (run ? ' stop' : '')} disabled={!trading}
            onClick={() => {
              if (!run && live && !confirm('REAL account! Start auto trading?')) return
              if (!run) { R.current.pnl = 0; R.current.n = 0; setStats({ n: 0, pnl: 0 }) } // fresh P/L for each run
              setRun(!run)
            }}>
            {run ? 'Stop bot' : tok ? 'Start bot' : 'Log in to start'}
          </button>
        </div>
      </div>
    </div>
  )
}
