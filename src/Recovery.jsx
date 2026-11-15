import { useCallback, useEffect, useRef, useState } from 'react'

const PUB = 'wss://api.derivws.com/trading/v1/options/ws/public' // market data, no login needed
const APP_ID = import.meta.env.VITE_DERIV_APP_ID
const redirectUri = () => window.location.origin + '/'
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
// token lives in localStorage so closing the tab/browser does not log you out
const store = {
  get: k => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
  del: k => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}
const saveTok = j => {
  store.set('tok', j.access_token)
  if (j.refresh_token) store.set('rtok', j.refresh_token)
  if (j.expires_in) store.set('tokExp', String(Date.now() + j.expires_in * 1000)); else store.del('tokExp')
}
let refreshing = null
const refreshToken = () => { // standard OAuth2 refresh; returns the new access token or null
  if (!refreshing) refreshing = (async () => {
    const rt = store.get('rtok'); if (!rt) return null
    try { const j = await api({ action: 'refresh', refresh_token: rt }); if (!j.access_token) return null; saveTok(j); return j.access_token } catch { return null }
  })().finally(() => { refreshing = null })
  return refreshing
}
// streak lengths from a price series: barrier hit when |move| >= pct * previous price.
// Scanner decision uses the last 30 completed streaks (average + median).
const streakStats = (px, pct) => {
  const out = []; let cur = 0
  for (let i = 1; i < px.length; i++) {
    if (Math.abs(px[i] - px[i - 1]) >= pct * px[i - 1] - 1e-9) { out.push(cur); cur = 0 } else cur++
  }
  out.shift() // oldest streak is cut off by the window
  const L = out.slice(-30), k = L.length
  const avg = k ? L.reduce((x, y) => x + y, 0) / k : 0
  const sorted = [...L].sort((x, y) => x - y), mid = Math.floor(k / 2)
  const med = k ? (k % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2) : 0
  return { cur, last: out.length ? out[out.length - 1] : 0, avg, med, k }
}
// Market quality from recent ticks. volX = recent tick volatility / long-run volatility (1.0 = normal, >1.3 = burst).
// er = efficiency ratio over the window (0 = pure chop, 1 = straight trend). Both too high -> skip entries.
const qualityOf = (px, pct, N, volMax, erMax) => {
  if (!pct || px.length < Math.max(N + 2, 60)) return null
  const d = []; for (let i = 1; i < px.length; i++) d.push(px[i] - px[i - 1])
  const rec = d.slice(-N), lng = d.slice(-300)
  const rms = a => Math.sqrt(a.reduce((t, x) => t + x * x, 0) / a.length)
  const volX = rms(rec) / (rms(lng) || 1)
  const path = rec.reduce((t, x) => t + Math.abs(x), 0)
  const er = path ? Math.abs(px[px.length - 1] - px[px.length - 1 - N]) / path : 0
  const ok = volX <= volMax && er <= erMax
  const why = volX > volMax ? `volatility ${volX.toFixed(2)}× > ${volMax}×` : er > erMax ? `trending ${er.toFixed(2)} > ${erMax}` : ''
  return { volX, er, ok, why }
}
const lim = v => (+v > 0 ? +v : Infinity) // blank / 0 = no limit
const api = async body => {
  const r = await fetch('/api/deriv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(r.status + ' ' + JSON.stringify(j).slice(0, 250))
  return j
}
const norm = a => ({ id: a.account_id || a.id || a.loginid, demo: /demo|virtual/i.test(JSON.stringify(a)), bal: a.balance, cur: a.currency })
const M_N = { 'Volatility 10 Index': 'R_10', 'Volatility 25 Index': 'R_25', 'Volatility 50 Index': 'R_50', 'Volatility 75 Index': 'R_75', 'Volatility 100 Index': 'R_100' }
const M_1S = { 'Volatility 10 (1s) Index': '1HZ10V', 'Volatility 25 (1s) Index': '1HZ25V', 'Volatility 50 (1s) Index': '1HZ50V', 'Volatility 75 (1s) Index': '1HZ75V', 'Volatility 100 (1s) Index': '1HZ100V' }
const TO_1S = { R_10: '1HZ10V', R_25: '1HZ25V', R_50: '1HZ50V', R_75: '1HZ75V', R_100: '1HZ100V' }
const TO_N = Object.fromEntries(Object.entries(TO_1S).map(([a, b]) => [b, a]))
let MARKETS = M_N // re-pointed on every render: 1s markets while Rotate + Recovery is on
const r2 = x => Math.round(x * 100) / 100
// Recovery steps alternate: step 1 Over 2 (waits for 0-1-2 digits in a row), step 2 Under 7 (waits for 7-8-9), step 3 Over 2 ...
const KIND = {
  over: { type: 'DIGITOVER', barrier: '2', label: 'Over 2', dig: '0-1-2', word: 'low', is: d => d <= 2 },
  under: { type: 'DIGITUNDER', barrier: '7', label: 'Under 7', dig: '7-8-9', word: 'high', is: d => d >= 7 },
}
const isRecType = t => t === 'DIGITOVER' || t === 'DIGITUNDER'
const decimals = v => { const t = String(v); const i = t.indexOf('.'); return i < 0 ? 0 : t.length - i - 1 }
// share of last digits 0,1,2 in the last N ticks (Over 2 wins on 3-9, so a LOW share is better). pip = decimals of the quote.
const digitShare = (px, pip, N) => {
  const a = px.slice(-N)
  if (a.length < Math.min(N, 100)) return null
  const dp = pip != null ? pip : Math.max(...a.map(decimals))
  let c = 0, h = 0
  for (const v of a) { const g = +v.toFixed(dp).slice(-1); if (g <= 2) c++; if (g >= 7) h++ }
  return { p012: c / a.length, p789: h / a.length, n: a.length }
}

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

export default function App({ tabs }) {
  const [cfg, setCfg] = useState({ symbol: '1HZ100V', growth: 0.01, target: 2, wait: 0, stake: 1, maxLoss: 5, maxProfit: 5, rr: true, rrTp: 10, rrEntry: 'hit', rrMult: 3, rrSteps: 3, rrMaxStake: 30, rrDigN: 500, rrNeed: 2, rrWatch: 2, qOn: false, qExit: true, qN: 20, qVol: 1.3, qTrend: 0.5, scanOn: true, autoSwitch: false, rotate: false })
  const [run, setRun] = useState(false)
  const [ticks, setTicks] = useState([])
  const [bar, setBar] = useState(null)
  const [accts, setAccts] = useState([])
  const [acct, setAcct] = useState(null)
  const [balance, setBalance] = useState(null)
  const [log, setLog] = useState([])
  const [stats, setStats] = useState({ n: 0, pnl: 0, w: 0, l: 0 })
  const [streaks, setStreaks] = useState([])
  const [hit, setHit] = useState(false)
  const [menu, setMenu] = useState(false)   // account dropdown
  const [scan, setScan] = useState({}) // market scanner results
  const [recUi, setRecUi] = useState(null) // recovery status badge
  const [recStats, setRecStats] = useState({ done: {}, failed: 0 }) // how many recoveries finished at step 1 / 2 / 3 ...
  const [quality, setQuality] = useState(null) // current market quality (volatility / trend)
  const scanApi = useRef(null)
  const firstGrowth = useRef(true)
  const [fail, setFail] = useState(false) // connection/login problem -> show Retry
  const [vis, setVis] = useState(60) // how many ticks the chart shows (zoom)
  const onZoom = useCallback(dir => setVis(v => Math.min(280, Math.max(12, Math.round(v * (dir > 0 ? 1.25 : 0.8))))), [])
  const onReset = useCallback(() => setVis(60), [])
  const [marks, setMarks] = useState([])
  const ws = useRef(null)
  const R = useRef({ pnl: 0, n: 0, w: 0, l: 0, since: 999 })
  const C = useRef(cfg); C.current = cfg
  const RUN = useRef(run); RUN.current = run
  MARKETS = cfg.rr ? M_1S : M_N
  const send = o => ws.current?.readyState === 1 && ws.current.send(JSON.stringify(o))
  const addLog = t => setLog(l => [new Date().toLocaleTimeString() + '  ' + t, ...l].slice(0, 60))

  const reqProposal = () => {
    const c = C.current, r = R.current
    r.pendingSub = false; r.reqAt = Date.now()
    if (!(+c.stake >= 1)) return // Deriv minimum stake is 1.00
    r.reqPending = true
    const tp = c.rr ? r2(+c.stake * (+c.rrTp || 10) / 100) : 0 // take profit in USD = stake x %
    r.tpAmt = tp
    send({ proposal: 1, subscribe: 1, amount: +c.stake, basis: 'stake', contract_type: 'ACCU', currency: r.cur || 'USD', growth_rate: +c.growth, underlying_symbol: c.symbol, ...(tp > 0 ? { limit_order: { take_profit: tp } } : {}) })
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
  const rotateMarket = () => { // next trade goes to the next market (V10 -> V25 -> V50 -> V75 -> V100 -> V10 ...)
    const r = R.current, syms = Object.values(MARKETS), cur = C.current.symbol
    const ok = r.okSyms && r.okSyms.length ? r.okSyms : syms // scanner on: only markets that pass the filter
    const i = syms.indexOf(cur); let next = null
    for (let k = 1; k <= syms.length; k++) { const sy = syms[(i + k) % syms.length]; if (ok.includes(sy)) { next = sy; break } }
    if (!next || next === cur) return
    r.lastSwitch = Date.now()
    setCfg(c => ({ ...c, symbol: next }))
    addLog(`🔁 Next trade on ${Object.keys(MARKETS).find(k => MARKETS[k] === next)}`)
  }
  const switchToBest = why => { // go to the calmest market right now (used after a quality exit)
    const r = R.current, b = r.bestRow
    if (!b || b.sy === C.current.symbol) { addLog('⏳ No calmer market right now — waiting for quality to return'); return }
    r.lastSwitch = Date.now()
    setCfg(c => ({ ...c, symbol: b.sy }))
    addLog(`🔁 ${why} → switched to ${b.name}`)
  }
  const pushRecStats = () => setRecStats({ done: { ...(R.current.recDone || {}) }, failed: R.current.recFail || 0 })
  const forgetQuotes = () => { const rec = R.current.rec; if (!rec?.q) return; Object.values(rec.q).forEach(x => x.subId && send({ forget: x.subId })); rec.q = {} }
  const stopRR = why => {
    const r = R.current
    if (r.rec) { r.recFail = (r.recFail || 0) + 1; pushRecStats() }
    clearTimeout(r.recTimer); clearTimeout(r.hopTimer)
    if (r.rec?.stage === 'wait') forgetQuotes()
    r.rec = null; r.recovering = false; setRecUi(null); setRun(false); addLog(why)
  }
  const waitMs = () => Math.max(5, ((R.current.rec?.order?.length) || 5) * (+C.current.rrWatch || 2) + 1) * 60000
  const recWatch = (ms = 25000) => {
    const r = R.current; clearTimeout(r.recTimer)
    r.recTimer = setTimeout(() => {
      if (!r.rec) return
      stopRR(r.rec.stage === 'wait' ? `⏱ No digit pattern within ${Math.round(ms / 60000)} minutes — bot stopped. Debt ≈ ${r.rec.debt.toFixed(2)}` : `⚠️ Recovery stalled (no reply from Deriv) — bot stopped. Debt ≈ ${r.rec.debt.toFixed(2)}`)
    }, ms)
  }
  const runOf = (kind, sy) => ((kind === 'under' ? R.current.highRun : R.current.lowRun) || {})[sy] || 0 // digits of the wanted group in a row
  const recBadge = () => {
    const r = R.current, rec = r.rec
    if (!rec) return null
    return { debt: rec.debt, stake: rec.stake, step: rec.step, name: rec.name, phase: rec.stage, kind: rec.kind, seq: runOf(rec.kind, rec.sym), need: rec.need, tape: ((r.tapes || {})[rec.sym] || []).slice(-8), pos: (rec.idx || 0) + 1, total: (rec.order || []).length, watch: +C.current.rrWatch || 2 }
  }
  // live quotes (Over 2 or Under 7, depending on the step) for ALL candidate markets (so a buy can go out instantly on whichever market is being watched)
  const subAllQuotes = () => {
    const r = R.current, rec = r.rec
    rec.q = {}
    rec.order.forEach((o, i) => setTimeout(() => {
      if (R.current.rec === rec && rec.stage === 'wait') send({ proposal: 1, subscribe: 1, amount: rec.stake, basis: 'stake', contract_type: KIND[rec.kind].type, barrier: KIND[rec.kind].barrier, duration: 1, duration_unit: 't', currency: r.cur || 'USD', underlying_symbol: o.sy })
    }, i * 150))
  }
  const fireOver = () => {
    const r = R.current, rec = r.rec
    const qd = rec && rec.q && rec.q[rec.sym]
    if (!rec || rec.stage !== 'wait' || !qd || !qd.pid) return // no quote yet: it fires as soon as the quote arrives (rec.go stays true)
    rec.stage = 'buy'; rec.go = false; rec.pid = qd.pid; rec.used = [...(rec.used || []), rec.sym] // this market is used up for the next steps
    clearTimeout(r.hopTimer); recWatch()
    send({ buy: rec.pid, price: rec.stake })
    forgetQuotes() // quote streams are no longer needed
    addLog(`⚡ ${runOf(rec.kind, rec.sym) || rec.need} ${KIND[rec.kind].word} digits (${KIND[rec.kind].dig}) in a row on ${rec.name} → buying ${KIND[rec.kind].label} now`)
    setRecUi(recBadge())
  }
  // watch one market for `rrWatch` seconds; if the pattern does not complete, move on to the next-lowest 0-1-2 market
  const focusMarket = idx => {
    const r = R.current, rec = r.rec
    if (!rec || rec.stage !== 'wait') return
    rec.idx = idx; const o = rec.order[idx]; rec.sym = o.sy; rec.name = o.name; rec.go = false
    setRecUi(recBadge())
    if (runOf(rec.kind, rec.sym) >= rec.need) { rec.go = true; fireOver() } // the pattern is already there
    if (rec.stage !== 'wait') return
    clearTimeout(r.hopTimer)
    r.hopTimer = setTimeout(() => { if (R.current.rec === rec && rec.stage === 'wait') focusMarket((rec.idx + 1) % rec.order.length) }, Math.max(5000, (+C.current.rrWatch || 2) * 60000))
  }
  // every live tick of every scanned market: keeps the running count of low digits (0-1-2) in a row per market
  const onRecTick = (sy, dgt) => {
    const r = R.current
    r.lowRun = r.lowRun || {}; r.highRun = r.highRun || {}; r.tapes = r.tapes || {}
    r.lowRun[sy] = dgt <= 2 ? (r.lowRun[sy] || 0) + 1 : 0
    r.highRun[sy] = dgt >= 7 ? (r.highRun[sy] || 0) + 1 : 0
    r.tapes[sy] = [...(r.tapes[sy] || []).slice(-11), dgt]
    const rec = r.rec
    if (!rec || rec.stage !== 'wait' || rec.sym !== sy) return
    if (runOf(rec.kind, sy) >= rec.need) { rec.go = true; fireOver() }
    setRecUi(recBadge())
  }
  R.current.onRecTick = onRecTick
  const placeOver = () => {
    const r = R.current, c = C.current, rec = r.rec
    if (!rec) return
    if (rec.step > (+c.rrSteps || 3)) return stopRR(`⛔ Recovery steps limit (${c.rrSteps}) reached — bot stopped. Debt ≈ ${rec.debt.toFixed(2)}`)
    if (rec.stake > (+c.rrMaxStake || 30)) return stopRR(`⛔ Recovery stake ${rec.stake.toFixed(2)} is above the cap (${c.rrMaxStake}) — bot stopped. Debt ≈ ${rec.debt.toFixed(2)}`)
    rec.kind = rec.step % 2 === 1 ? 'over' : 'under' // 1: Over 2, 2: Under 7, 3: Over 2, ...
    const K = KIND[rec.kind], share = x => (rec.kind === 'under' ? x.q : x.p)
    let order = (r.digRows || []).filter(x => share(x) != null && !(rec.used || []).includes(x.sy)).sort((a, b) => share(a) - share(b)) // fewest digits of the group first, never a market used by an earlier step
    if (!order.length && (rec.used || []).length) { rec.used = []; order = (r.digRows || []).filter(x => share(x) != null).sort((a, b) => share(a) - share(b)) } // all markets used: start over
    if (!order.length) return stopRR('⚠️ No digit statistics yet (scanner still loading) — bot stopped')
    rec.order = order; rec.stage = 'wait'; rec.pid = null; rec.cid = null; rec.fails = 0; rec.go = false
    rec.need = Math.max(1, Math.min(5, +c.rrNeed || 2))
    addLog(`🎲 Recovery step ${rec.step}: ${K.label} stake ${rec.stake.toFixed(2)} — need ${rec.need} ${K.word} digits (${K.dig}) in a row, ${+c.rrWatch || 2} min per market, new market each step, order: ${order.map(o => `${o.name.replace(' Index', '')} ${(share(o) * 100).toFixed(0)}%`).join(' → ')}`)
    recWatch(waitMs())
    subAllQuotes()
    focusMarket(0)
  }
  const startRecovery = loss => {
    const r = R.current, c = C.current
    r.recovering = true
    r.rec = { debt: loss, stake: r2(loss * (+c.rrMult || 3)), step: 1, used: [], kind: 'over' }
    placeOver()
  }
  const onOverResult = p => {
    const r = R.current, c = C.current, rec = r.rec
    clearTimeout(r.recTimer)
    const profit = +p.profit
    r.pnl += profit; r.n++; if (profit > 0) r.w++; else r.l++; setStats({ n: r.n, pnl: r.pnl, w: r.w, l: r.l })
    addLog(`${profit >= 0 ? '✅ ' : '🔴 '}${KIND[rec.kind].label} ${profit >= 0 ? 'WIN' : 'LOSS'}  ${profit.toFixed(2)}`)
    if (profit > 0) rec.debt -= profit; else rec.debt += rec.stake
    if (profit > 0 && rec.debt <= 0.005) { // recovered -> normal accumulator trading again
      r.recDone = r.recDone || {}; r.recDone[rec.step] = (r.recDone[rec.step] || 0) + 1; pushRecStats() // recovered at this step
      r.rec = null; r.recovering = false; setRecUi(null)
      addLog(`✅ Loss recovered at step ${rec.step} — back to normal accumulator trading`)
      if (r.pnl >= lim(c.maxProfit)) { setRun(false); addLog(`🎯 Profit target reached (+${r.pnl.toFixed(2)}) — bot stopped`); return }
      rotateMarket(); return
    }
    if (r.pnl <= -lim(c.maxLoss)) { stopRR(`⛔ Loss limit reached (${r.pnl.toFixed(2)}) — bot stopped. Debt ≈ ${rec.debt.toFixed(2)}`); return }
    rec.stake = profit > 0 ? r2((+c.rrMult || 3) * rec.debt) : r2(rec.stake * (+c.rrMult || 3))
    rec.step++
    placeOver()
  }
  const resetBot = () => { // clear P/L + stuck flags so the bot can be started again (no page refresh needed)
    const r = R.current
    if (r.open) { addLog('⚠️ A trade is still open — wait until it closes, then press Reset'); return }
    setRun(false); clearTimeout(r.recTimer); clearTimeout(r.hopTimer); if (r.rec?.stage === 'wait') forgetQuotes(); r.rec = null; r.recovering = false; setRecUi(null)
    r.recDone = {}; r.recFail = 0; setRecStats({ done: {}, failed: 0 })
    r.pnl = 0; r.n = 0; r.w = 0; r.l = 0; r.busy = false; r.selling = false; r.inTicks = 0
    setStats({ n: 0, pnl: 0, w: 0, l: 0 }); setMarks([])
    subProposal() // fresh proposal stream
    addLog('🔄 Bot reset — press Start bot')
  }
  const calcQuality = () => {
    const r = R.current, c = C.current
    const q = qualityOf(r.px || [], r.pct, +c.qN || 20, +c.qVol || 1.3, +c.qTrend || 0.5)
    r.quality = q; setQuality(q)
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
    const key = `${c.symbol}|${c.growth}|${c.stake}|${c.rr ? c.rrTp : 0}`
    if (r.subKey === key) return // nothing changed -> don't spam Deriv (rate limits)
    r.subKey = key
    const gk = c.symbol + '|' + c.growth
    if (r.gk !== gk) { r.gk = gk; r.pct = null; r.lastQ = null; setBar(null) } // different market / growth rate -> different barrier
    if (r.tickSym !== c.symbol) { // market changed (or first connect on this socket)
      if (r.lastSym !== c.symbol) { r.since = 999; r.lastStay = null; r.hist = []; r.px = []; r.quality = null; setQuality(null); setTicks([]); setMarks([]); setStreaks([]) } // same market on a new socket: keep the chart
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
    r.busy = true; r.selling = false; r.qSold = false
    send({ buy: r.pid, price: r.ask || +C.current.stake })
    r.pid = null // a bought proposal id is single-use
  }
  const onTick = (q, epoch) => {
    const r = R.current, c = C.current
    if (epoch && r.lastT && epoch <= r.lastT) return // already have this tick (history overlap)
    setTicks(t => [...t.slice(-299), { q, t: epoch || Date.now() / 1000 }])
    r.lastT = epoch || Date.now() / 1000
    r.px = [...(r.px || []).slice(-299), q]; recalcStreaks(); calcQuality()
    const prevQ = r.lastQ; r.lastQ = q
    // barrier = previous spot +/- pct, so a hit is |move| >= pct * previous price (works even before the new proposal arrives)
    if (prevQ != null && r.pct && Math.abs(q - prevQ) >= r.pct * prevQ - 1e-9) { r.lastBreakAt = Date.now(); flashRed() }
    if (r.open) { // contract running: count ticks ourselves, sell after entry tick + target ticks
      r.inTicks = (r.inTicks || 0) + 1
      if (c.rr) return // take-profit closes the trade (server side), not a tick counter
      const bad = c.qOn && c.qExit && r.quality && !r.quality.ok // quality dropped while we are in the trade
      if (!r.selling && (r.inTicks >= +c.target + 1 || (bad && r.inTicks >= 2))) {
        if (bad && r.inTicks < +c.target + 1) { if (!r.qSold) addLog(`⚠️ Market quality dropped (${r.quality.why}) — selling now`); r.qSold = true }
        r.selling = true; send({ sell: r.open, price: 0 })
      }
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
    if (!(RUN.current && r.trading && !r.open && !r.busy && !r.recovering && r.pnl > -lim(c.maxLoss) && r.pnl < lim(c.maxProfit) && r.marketOk !== false && ((c.rr && c.rrEntry === 'now') || r.since === +c.wait))) return
    if (c.qOn && !r.quality?.ok) { // market too volatile / trending right now -> skip this entry
      if (Date.now() - (r.qLog || 0) > 20000) { r.qLog = Date.now(); addLog(`⏭ Entry skipped — ${r.quality?.why || 'checking market…'}`) }
      return
    }
    buy()
  }
  const onPoc = p => {
    const r = R.current, c = C.current
    if (r.rec && r.rec.cid && p.contract_id === r.rec.cid) { if (p.is_sold) onOverResult(p); return } // Over 2 recovery trade
    if (p.is_sold) {
      if (r.open !== p.contract_id) return
      r.open = null; r.busy = false; r.pnl += +p.profit; r.n++; if (+p.profit > 0) r.w++; else r.l++
      setStats({ n: r.n, pnl: r.pnl, w: r.w, l: r.l })
      addMark(p.sell_time || r.lastT, p.profit >= 0 ? 'win' : 'loss')
      addLog(`${p.profit >= 0 ? '✅ WIN' : '🔴 LOSS'}  ${(+p.profit).toFixed(2)}`)
      const hitT = r.pnl >= lim(c.maxProfit), hitL = r.pnl <= -lim(c.maxLoss)
      if (hitT) { setRun(false); addLog(`🎯 Profit target reached (+${r.pnl.toFixed(2)}) — bot stopped`) }
      else if (hitL) { setRun(false); addLog(`⛔ Loss limit reached (${r.pnl.toFixed(2)}) — bot stopped`) }
      if (c.rr) { // Rotate + Recovery: win (take profit) -> next market, loss -> Over 2 recovery
        if (!hitT && !hitL) { if (+p.profit >= 0) rotateMarket(); else startRecovery(Math.abs(+p.profit)) }
      } else if (r.qSold) { r.qSold = false; if (c.autoSwitch) switchToBest('Quality dropped') } // sold because of quality -> move to a calm market
      else if (c.rotate) rotateMarket()
      return
    }
    // fallback if the server-side take-profit did not fire: sell when profit reaches the target
    if (c.rr && r.tpAmt && !r.selling && r.open === p.contract_id && +p.profit >= r.tpAmt) { r.selling = true; send({ sell: p.contract_id, price: 0 }) }
  }
  const onMsg = e => {
    const m = JSON.parse(e.data), r = R.current
    if (m.error) {
      if (/not found among your open/i.test(m.error.message || '')) return // contract already closed; harmless
      if (r.rec && r.rec.stage === 'buy' && m.echo_req?.buy && m.echo_req.buy === r.rec.pid && (r.rec.fails || 0) < 3) {
        const rec = r.rec; rec.fails = (rec.fails || 0) + 1
        addLog(`⚠️ ${KIND[rec.kind].label} buy failed (${m.error.message || ''}) — waiting for the next pattern (${rec.fails}/3)`)
        rec.stage = 'wait'; rec.pid = null; rec.go = false
        recWatch(waitMs()); subAllQuotes(); focusMarket(rec.idx || 0); return
      }
      if (r.rec && (isRecType(m.echo_req?.contract_type) || (m.echo_req?.buy && m.echo_req.buy === r.rec.pid))) {
        stopRR(`❌ ${KIND[r.rec.kind || 'over'].label} failed: ${m.error.message || ''} — bot stopped. Debt ≈ ${r.rec.debt.toFixed(2)}`); return
      }
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
        r.px = arr.map(a => a.q).slice(-300); recalcStreaks(); calcQuality()
        setTicks(arr.slice(-300))
        break
      }
      case 'balance': setBalance(`${m.balance.balance} ${m.balance.currency}`); r.cur = m.balance.currency; break
      case 'proposal': {
        if (isRecType(m.echo_req?.contract_type)) { // recovery: live quote (Over 2 / Under 7) for one market
          const rec = r.rec, sy = m.echo_req.underlying_symbol
          if (rec && m.proposal?.id && rec.stage === 'wait' && rec.q && +m.echo_req.amount === rec.stake) {
            const cur = rec.q[sy] || {}
            rec.q[sy] = { pid: m.proposal.id, subId: m.subscription?.id || cur.subId }
            if (rec.go && sy === rec.sym) fireOver()
          } else if (m.subscription?.id) send({ forget: m.subscription.id }) // stale quote stream: drop it
          break
        }
        const d = m.proposal.contract_details || {}
        r.reqPending = false
        r.pid = m.proposal.id; r.subId = m.subscription?.id || r.subId; r.propAt = Date.now()
        r.ask = +m.proposal.ask_price || null; r.propStake = m.echo_req?.amount != null ? +m.echo_req.amount : null
        if (r.redo) { r.redo = false; subProposal(); break } // settings changed while request was in flight
        if (d.high_barrier) { r.bar = { high: +d.high_barrier, low: +d.low_barrier }; setBar(r.bar); r.pct = (r.bar.high - r.bar.low) / (r.bar.high + r.bar.low) }
        if (r.pct) { r.hasStay = true; recalcStreaks(); calcQuality(); maybeEnter() } // streak counted from prices; buy right away on a fresh proposal
        break
      }
      case 'buy': if (r.rec && r.rec.stage === 'buy' && m.echo_req?.buy === r.rec.pid) {
          r.rec.cid = m.buy.contract_id; r.rec.stage = 'open'; recWatch()
          addLog(`🎲 ${KIND[r.rec.kind].label} bought on ${r.rec.name} (#${m.buy.contract_id})`)
          send({ proposal_open_contract: 1, contract_id: m.buy.contract_id, subscribe: 1 }); break
        }
        addMark(m.buy.start_time || r.lastT, 'buy'); r.open = m.buy.contract_id; r.busy = false; r.inTicks = 0; r.selling = false; subProposal(); addLog(`🟢 Bought #${m.buy.contract_id}`)
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
    const old = ws.current; ws.current = null
    if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; old.close() } // retired socket must not log errors
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
    s.onerror = () => { if (ws.current === s) addLog('Socket error') } // ignore errors from replaced sockets
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
  const logout = () => { ['tok', 'rtok', 'tokExp', 'accts', 'acctId'].forEach(k => store.del(k)); setAccts([]); setAcct(null); setBalance(null); setRun(false); connect(PUB, false) }

  const useAccount = async (a, tok, retried = false) => {
    try {
      setAcct(a); setRun(false); setBalance(null); store.set('acctId', a.id)
      const j = await withRetry(() => api({ action: 'otp', token: tok, accountId: a.id }), 'account')
      const url = j.data?.url
      if (!url) throw new Error('OTP url nehe: ' + JSON.stringify(j).slice(0, 200))
      R.current.cur = a.cur
      connect(url, true)
    } catch (e) {
      const msg = String(e.message || e)
      if (/^40[13]/.test(msg) && !retried) { const nt = await refreshToken(); if (nt) return useAccount(a, nt, true) }
      addLog('❌ ' + msg); setFail(true)
    }
  }
  const retryNow = () => { setFail(false); const t = store.get('tok'); if (!t) return; accts.length ? useAccount(acct || accts[0], t) : loadAccounts(t) }
  const loadAccounts = async (tok0, refreshed = false) => {
    let tok = tok0
    const exp = +(store.get('tokExp') || 0)
    if (exp && Date.now() > exp - 60000) { const nt = await refreshToken(); if (nt) tok = nt } // refresh before it expires
    let cached = null
    try { cached = JSON.parse(store.get('accts') || 'null') } catch { /* ignore */ }
    const want = store.get('acctId')
    if (cached?.length) { setAccts(cached); useAccount(cached.find(a => a.id === want) || cached.find(a => a.demo) || cached[0], tok) } // no waiting for the accounts call
    try {
      const j = await withRetry(() => api({ action: 'accounts', token: tok }), 'accounts')
      const list = (Array.isArray(j.data) ? j.data : j.data?.accounts || j.accounts || []).map(norm).filter(a => a.id)
      if (!list.length) return addLog('❌ Accounts nehe: ' + JSON.stringify(j).slice(0, 250))
      setAccts(list); store.set('accts', JSON.stringify(list))
      if (!cached?.length) useAccount(list.find(a => a.demo) || list[0], tok) // demo first = safer
    } catch (e) {
      const msg = String(e.message || e)
      if (cached?.length && !/^40[13]/.test(msg)) return // already connected from the saved list; refresh failed silently
      if (/^40[13]/.test(msg)) {
        if (!refreshed) { const nt = await refreshToken(); if (nt) return loadAccounts(nt, true) }
        ['tok', 'rtok', 'tokExp', 'accts'].forEach(k => store.del(k)); addLog('❌ Login expired — please log in again')
      }
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
        .then(j => { saveTok(j); loadAccounts(j.access_token) })
        .catch(e => { addLog('❌ Login failed: ' + String(e.message).slice(0, 120) + ' — please log in again'); setFail(true) })
    } else {
      const t = store.get('tok'); if (t) loadAccounts(t)
    }
  }, [])

  useEffect(() => { // debounce: don't re-subscribe on every keystroke in the stake box
    const id = setTimeout(() => { if (ws.current?.readyState === 1) subscribe() }, 700)
    return () => clearTimeout(id)
  }, [cfg.symbol, cfg.growth, cfg.stake, cfg.rr, cfg.rrTp])

  // ---- Market scanner: its own public socket watches all 5 markets (history + live ticks + barrier %).
  // Requests go out ONE AT A TIME (queue) and failed markets are retried, so Deriv rate limits don't leave markets empty.
  useEffect(() => {
    if (!cfg.scanOn) { setScan({}); return }
    const syms = Object.values(MARKETS), D = {}
    syms.forEach(sy => { D[sy] = { px: [], pct: null, t: 0, sub: false, err: '', warned: 0, count: 3000 } })
    const w = new WebSocket(PUB)
    let dead = false, cur = null, timer = null, hold = 0
    const q = [], queued = new Set()
    const send1 = o => w.readyState === 1 && w.send(JSON.stringify(o))
    const enqueue = (type, sy) => { const k = type + sy; if (queued.has(k)) return; queued.add(k); q.push({ type, sy }) }
    const finish = (type, sy, err) => {
      if (!cur || cur.type !== type || cur.sy !== sy) return
      clearTimeout(timer); queued.delete(type + sy); cur = null
      const rl = !!err && /rate limit/i.test(err)
      if (err) { D[sy].err = err; if (!rl && Date.now() - D[sy].warned > 30000) { D[sy].warned = Date.now(); addLog(`⚠️ Scanner ${sy}: ${err}`) } }
      if (rl) hold = Date.now() + 15000 // rate limited: pause the queue, the 8s retry loop re-queues the market
      setTimeout(pump, rl ? 15000 : type === 'h' ? 1500 : 350) // history is the heavy request -> longer gap
    }
    const pump = () => {
      if (dead || cur || w.readyState !== 1 || Date.now() < hold) return
      const t = q.shift(); if (!t) return
      cur = t
      send1(t.type === 'h'
        ? { ticks_history: t.sy, end: 'latest', count: D[t.sy].count, style: 'ticks', subscribe: 1 }
        : { proposal: 1, amount: 1, basis: 'stake', contract_type: 'ACCU', currency: 'USD', growth_rate: +C.current.growth, underlying_symbol: t.sy })
      timer = setTimeout(() => finish(t.type, t.sy, 'timeout'), 5000)
    }
    const fill = () => syms.forEach(sy => { const d = D[sy]; if (!d.sub) enqueue('h', sy); if (!d.pct) enqueue('p', sy) })
    w.onopen = () => { fill(); pump() }
    w.onmessage = e => {
      const m = JSON.parse(e.data), er = m.echo_req || {}
      if (m.error) {
        const sy = er.ticks_history || er.underlying_symbol
        if (sy && D[sy]) {
          if (/already subscribed/i.test(m.error.message || '')) { D[sy].sub = true; finish('h', sy) }
          else {
            if (er.ticks_history && !/rate limit/i.test(m.error.message || '')) D[sy].count = Math.max(500, Math.floor(D[sy].count / 2)) // maybe too many ticks requested
            finish(er.ticks_history ? 'h' : 'p', sy, m.error.message)
          }
        }
        return
      }
      if (m.msg_type === 'history' || m.msg_type === 'ticks_history') {
        const sy = er.ticks_history, d = D[sy]
        if (d && m.history?.prices) { if (m.pip_size != null) d.pip = +m.pip_size; d.px = m.history.prices.map(Number).slice(-5000); d.pipInf = Math.max(...d.px.map(decimals));
          { const dpH = d.pip != null ? d.pip : d.pipInf, dg = d.px.slice(-14).map(v => +v.toFixed(dpH).slice(-1)); let run = 0; for (let i = dg.length - 1; i >= 0 && dg[i] <= 2; i--) run++
            let hrun = 0; for (let i = dg.length - 1; i >= 0 && dg[i] >= 7; i--) hrun++
            R.current.lowRun = R.current.lowRun || {}; R.current.highRun = R.current.highRun || {}; R.current.tapes = R.current.tapes || {}; R.current.lowRun[sy] = run; R.current.highRun[sy] = hrun; R.current.tapes[sy] = dg.slice(-12) } d.t = +m.history.times[m.history.times.length - 1]; d.sub = true; d.err = ''; finish('h', sy) }
      } else if (m.msg_type === 'tick') {
        const key = er.ticks_history || er.ticks || m.tick.symbol, d = D[key]
        if (d && m.tick.epoch > d.t) {
          if (m.tick.pip_size != null) d.pip = +m.tick.pip_size
          d.t = m.tick.epoch; d.px.push(+m.tick.quote); if (d.px.length > 5000) d.px.shift()
          const dp = d.pip != null ? d.pip : d.pipInf != null ? d.pipInf : decimals(+m.tick.quote)
          R.current.onRecTick?.(key, +(+m.tick.quote).toFixed(dp).slice(-1), m.tick.epoch)
        }
      } else if (m.msg_type === 'proposal') {
        const sy = er.underlying_symbol, d = D[sy], cd = m.proposal?.contract_details
        if (d && cd?.high_barrier && +er.growth_rate !== +C.current.growth) finish('p', sy) // answer for an old growth rate: ignore, it gets re-requested
        else if (d && cd?.high_barrier) { d.pct = (+cd.high_barrier - +cd.low_barrier) / (+cd.high_barrier + +cd.low_barrier); d.err = ''; finish('p', sy) }
      }
    }
    const iv = setInterval(() => {
      const out = {}
      syms.forEach(sy => {
        const d = D[sy], st = d.pct && d.px.length > 30 ? streakStats(d.px, d.pct) : null
        const dig = C.current.rr ? digitShare(d.px, d.pip, +C.current.rrDigN || 500) : null
        out[sy] = { ...(st && st.k >= 10 ? { ...st, q: qualityOf(d.px, d.pct, +C.current.qN || 20, +C.current.qVol || 1.3, +C.current.qTrend || 0.5) } : { pending: true, err: d.err }), dig } // streak data needs at least 10 completed streaks
      })
      setScan(out)
    }, 1000)
    const retry = setInterval(() => { fill(); pump() }, 8000) // markets that failed get requested again
    const ping = setInterval(() => send1({ ping: 1 }), 30000)
    // growth rate changed -> only the barrier % must be re-read; the tick history stays (no extra ticks_history requests)
    scanApi.current = { regrow: () => { syms.forEach(sy => { D[sy].pct = null; enqueue('p', sy) }); pump() } }
    return () => { scanApi.current = null; dead = true; clearTimeout(timer); clearInterval(iv); clearInterval(retry); clearInterval(ping); w.onopen = w.onmessage = w.onclose = null; w.close() }
  }, [cfg.scanOn, cfg.rr])
  useEffect(() => {
    if (firstGrowth.current) { firstGrowth.current = false; return }
    scanApi.current?.regrow()
  }, [cfg.growth])

  // Ranking is by MARKET QUALITY (volatility burst + trend), not by streak avg/median (those columns are info only).
  const volMax = +cfg.qVol || 1.3, erMax = +cfg.qTrend || 0.5
  const rows = Object.entries(MARKETS).map(([name, sy]) => {
    const d = scan[sy], q = d && !d.pending ? d.q : null
    const qs = q ? (q.volX / volMax + q.er / erMax) / 2 : null // lower = calmer (average of both limits' usage)
    return { name, sy, ...d, q, qs, ok: !!q?.ok }
  })
  const best = rows.filter(r => r.ok).sort((a, b) => a.qs - b.qs)[0]
  const curRow = rows.find(r => r.sy === cfg.symbol)
  R.current.bestRow = best || null
  R.current.digRows = rows.map(x => ({ sy: x.sy, name: x.name, p: x.dig ? x.dig.p012 : null, q: x.dig ? x.dig.p789 : null }))
  const recPick = cfg.rr ? [...rows].filter(x => x.dig).sort((a, b) => a.dig.p012 - b.dig.p012)[0] : null
  R.current.okSyms = cfg.scanOn && cfg.qOn && rows.filter(x => x.q).length >= 4 ? rows.filter(x => x.ok).map(x => x.sy) : null
  R.current.marketOk = !(cfg.scanOn && cfg.autoSwitch) || (quality ? quality.ok : !!curRow?.ok) // auto mode: only trade calm markets
  useEffect(() => { // auto-switch to the calmest market (not while a trade runs, max once per 60s)
    if (!cfg.scanOn || !cfg.autoSwitch || cfg.rotate || !best || best.sy === cfg.symbol) return
    if (rows.filter(x => x.q).length < 3) return // wait until most markets are scanned
    const r = R.current
    if (r.open || r.busy || Date.now() - (r.lastSwitch || 0) < 60000) return
    const curQ = r.quality || curRow?.q
    const curOk = curQ ? curQ.ok : true
    const curQs = curQ ? (curQ.volX / volMax + curQ.er / erMax) / 2 : 1
    if (curOk && best.qs > curQs * 0.7) return // current market is fine: only move if another is clearly calmer
    r.lastSwitch = Date.now()
    setCfg(c => ({ ...c, symbol: best.sy }))
    addLog(`🔁 Switched to ${best.name} (calmest: volatility ${best.q.volX.toFixed(2)}× · trend ${best.q.er.toFixed(2)})`)
  }, [scan])

  useEffect(() => { window.__botRunning = run; return () => { window.__botRunning = false } }, [run])
  const set = k => e => { const v = e.target.value; setCfg(c => ({ ...c, [k]: v })) }
  const tok = store.get('tok')
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
      {tabs}

      <div className="wrap">
        <div className="card">
          <div className="row"><b>{Object.keys(MARKETS).find(k => MARKETS[k] === cfg.symbol)}</b><span>{ticks.at(-1)?.q.toFixed(2)}</span></div>
          <Chart ticks={ticks} bar={bar} hit={hit} marks={marks} vis={vis} onZoom={onZoom} onReset={onReset} />
          <div className="row"><span>🛠 Recovered at{Array.from({ length: Math.min(6, Math.max(1, +cfg.rrSteps || 3)) }, (_, i) => i + 1).map(k => <span key={k} className="rstep">step {k}: <b className="g">{recStats.done[k] || 0}</b></span>)}{recStats.failed > 0 && <span className="rstep">· failed: <b className="r">{recStats.failed}</b></span>}</span>
            <span>Trades {stats.n} | <b className="g">Win {stats.w}</b> | <b className="r">Loss {stats.l}</b>{stats.n > 0 && <span className="muted"> ({Math.round((stats.w / stats.n) * 100)}%)</span>} | P/L <b className={stats.pnl >= 0 ? 'g' : 'r'}>{stats.pnl.toFixed(2)}</b> <button className="mini" onClick={resetBot} title="Reset P/L and bot state">↺ Reset</button></span></div>
          {recUi && (
            <div className="qbadge r">
              🛠 Recovery step {recUi.step}/{cfg.rrSteps} · debt {recUi.debt.toFixed(2)} · {recUi.kind === 'under' ? 'Under 7' : 'Over 2'} on {recUi.name} · stake {recUi.stake.toFixed(2)}
              {recUi.phase === 'wait' && <> · 👀 watching market {recUi.pos}/{recUi.total} ({recUi.watch} min each) · {recUi.kind === 'under' ? 'high digits (7-8-9)' : 'low digits (0-1-2)'} in a row: {recUi.seq}/{recUi.need}</>}
              {recUi.phase === 'buy' && <> · ⚡ buying</>}
              {recUi.tape?.length > 0 && <div className="tape">Last digits: {recUi.tape.map((d, i) => <b key={i} className={(recUi.kind === 'under' ? d >= 7 : d <= 2) ? 'low' : ''}>{d}</b>)}</div>}
            </div>
          )}
          {quality && (
            <div className={'qbadge ' + (quality.ok ? 'g' : 'r')}>
              {quality.ok ? '✅' : '⛔'} Market quality: volatility {quality.volX.toFixed(2)}× · trend {quality.er.toFixed(2)}
              {!cfg.qOn ? ' (filter off)' : quality.ok ? '' : ` — skipping entries (${quality.why})`}
            </div>
          )}
          {streaks.length > 0 && (
            <div className="chips"><span className="lbl">Streaks</span>
              {streaks.map((v, i) => <span key={i} className={'chip' + (i === 0 ? ' cur' : '')}>{v}</span>)}
            </div>
          )}
          <div className="scan">
            <div className="scanhead"><b>Market scanner — 1s markets</b><span className="muted">★ in "Digits 0-2" = market used for the next Over 2 recovery trade</span></div>
            {cfg.scanOn && (
              <table className="scantbl">
                <thead><tr><th>Market</th><th>Now</th><th>Last</th><th>Avg (30)</th><th>Median (30)</th><th>Vol× · Trend</th>{cfg.rr && <><th>Digits 0-2</th><th>Digits 7-9</th></>}<th></th></tr></thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.sy} className={r.sy === cfg.symbol ? 'cur' : ''} onClick={() => setCfg(c => ({ ...c, symbol: r.sy }))}>
                      <td>{r.sy === cfg.symbol ? '● ' : ''}{r.name.replace(' Index', '')}</td>
                      <td>{r.cur ?? '…'}</td><td>{r.last ?? '…'}</td><td>{r.avg != null ? r.avg.toFixed(1) : '…'}</td><td>{r.med != null ? r.med.toFixed(1) : '…'}</td><td className={r.q && !r.q.ok ? 'r' : ''}>{r.q ? `${r.q.volX.toFixed(2)}× · ${r.q.er.toFixed(2)}` : '…'}</td>
                      {cfg.rr && <td>{r.dig ? `${(r.dig.p789 * 100).toFixed(1)}%` : '…'}</td>}
                      {cfg.rr && <td className={recPick?.sy === r.sy ? 'g' : ''}>{r.dig ? `${(r.dig.p012 * 100).toFixed(1)}%${recPick?.sy === r.sy ? ' ★' : ''}` : '…'}</td>}
                      <td className={best?.sy === r.sy ? 'g' : r.q && !r.ok ? 'r' : ''}>{best?.sy === r.sy ? 'BEST ★' : !r.q ? (r.err ? 'retrying…' : '') : r.ok ? 'ok' : r.q.volX > volMax ? 'volatile' : 'trending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="log">{log.map((l, i) => <div key={i}>{l}</div>)}</div>
        </div>
        <div className="card side">
          <button className={'cta top' + (run ? ' stop' : '')} disabled={!trading}
            onClick={() => {
              if (run) { const r = R.current; clearTimeout(r.recTimer); clearTimeout(r.hopTimer); if (r.rec?.stage === 'wait') forgetQuotes(); r.rec = null; r.recovering = false; setRecUi(null) } // stopping cancels a pending recovery
              if (!run && live && !confirm('REAL account! Start auto trading?')) return
              if (!run) { // every Start = fresh P/L and clean flags
                const r = R.current
                r.pnl = 0; r.n = 0; r.w = 0; r.l = 0; r.recDone = {}; r.recFail = 0; setStats({ n: 0, pnl: 0, w: 0, l: 0 }); setRecStats({ done: {}, failed: 0 })
                if (!r.open) { r.busy = false; r.selling = false }
                addLog(cfg.rrEntry === 'now' ? '▶ Bot started — entering immediately' : `▶ Bot started — waiting for the next barrier hit (now ${r.since > 900 ? '-' : r.since} ticks since the last hit)`)
              }
              setRun(!run)
            }}>
            {run ? 'Stop bot' : tok ? 'Start bot' : 'Log in to start'}
          </button>
          <div className="g3">
            <div className="c2"><label>Market</label>
              <select value={cfg.symbol} onChange={set('symbol')}>{Object.entries(MARKETS).map(([n, sy]) => <option key={sy} value={sy}>{n}</option>)}</select></div>
            <div><label>Growth rate</label>
              <select value={cfg.growth} onChange={set('growth')}>{[1, 2, 3, 4, 5].map(g => <option key={g} value={g / 100}>{g}%</option>)}</select></div>
            <div><label title="Accumulator stake in USD">Stake ($)</label><input type="number" min="1" value={cfg.stake} onChange={set('stake')} /></div>
            <div><label title="Accumulator closes at this profit, as a % of the stake">Take profit (%)</label><input type="number" min="1" value={cfg.rrTp} onChange={set('rrTp')} /></div>
            <div><label title="Bot stops when the total loss reaches this (USD). Keep it above your recovery stakes.">Loss limit ($)</label><input type="number" min="0" value={cfg.maxLoss} onChange={set('maxLoss')} /></div>
            <div><label title="Session target: bot stops when the total profit reaches this (USD)">Profit target ($)</label><input type="number" min="0" value={cfg.maxProfit} onChange={set('maxProfit')} /></div>
            <div><label title="When a new accumulator trade is opened">Entry</label>
              <select value={cfg.rrEntry} onChange={set('rrEntry')}><option value="hit">after barrier hit</option><option value="now">immediately</option></select></div>
            <div><label title="Digits in a row before the recovery trade is bought: 0-1-2 for the Over 2 steps, 7-8-9 for the Under 7 steps">Digits in a row</label><input type="number" min="1" max="5" value={cfg.rrNeed} onChange={set('rrNeed')} /></div>
            <div><label title="Minutes to watch each market before moving to the next-lowest 0-1-2 market">Watch / market (min)</label><input type="number" min="0.1" max="30" step="0.5" value={cfg.rrWatch} onChange={set('rrWatch')} /></div>
            <div><label title="Recovery stake multiplier after each loss (step 1 Over 2, step 2 Under 7, step 3 Over 2 ...)">Recovery stake ×</label><input type="number" min="1" step="0.5" value={cfg.rrMult} onChange={set('rrMult')} /></div>
            <div><label title="Maximum recovery attempts (alternating Over 2 / Under 7, a different market each step)">Max steps</label><input type="number" min="1" value={cfg.rrSteps} onChange={set('rrSteps')} /></div>
            <div><label title="Bot stops if the next recovery stake would be above this (USD)">Max rec. stake ($)</label><input type="number" min="1" value={cfg.rrMaxStake} onChange={set('rrMaxStake')} /></div>
            <div><label title="Ticks used to find the market with the fewest 0-1-2 digits">Digit window</label><input type="number" min="100" value={cfg.rrDigN} onChange={set('rrDigN')} /></div>
          </div>
          <div className="qline">
            <label className="rotl" title="Skip new trades while the market is volatile / trending (1.0x = normal volatility; trend 0 = choppy, 1 = straight line)"><input type="checkbox" checked={cfg.qOn} onChange={e => { const v = e.target.checked; setCfg(c => ({ ...c, qOn: v })) }} /> 🛡 Skip when volatile / trending</label>
            <span>Window <input type="number" min="5" className="mini-in" value={cfg.qN} onChange={set('qN')} /></span>
            <span>Vol ≤ <input type="number" step="0.1" min="1" className="mini-in" value={cfg.qVol} onChange={set('qVol')} />×</span>
            <span>Trend ≤ <input type="number" step="0.05" min="0" max="1" className="mini-in" value={cfg.qTrend} onChange={set('qTrend')} /></span>
          </div>
        </div>
      </div>
    </div>
  )
}
