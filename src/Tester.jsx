import { useMemo, useRef, useState } from 'react'
import { analyzeMarket, summarize, loadTicks } from './testerCore.js'

const PUB = 'wss://api.derivws.com/trading/v1/options/ws/public'
const MARKETS = [
  ['Volatility 10 (1s)', '1HZ10V'], ['Volatility 25 (1s)', '1HZ25V'], ['Volatility 50 (1s)', '1HZ50V'], ['Volatility 75 (1s)', '1HZ75V'], ['Volatility 100 (1s)', '1HZ100V'],
  ['Volatility 10', 'R_10'], ['Volatility 25', 'R_25'], ['Volatility 50', 'R_50'], ['Volatility 75', 'R_75'], ['Volatility 100', 'R_100'],
]
const NAME = Object.fromEntries(MARKETS.map(([n, s]) => [s, n]))
const VERDICT = { promising: '🟢 Promising', noise: '⚪ Noise', below: '🔴 Below break-even', 'few trades': '— few trades' }

function Equity({ row, payout, capital, stake }) {
  if (!row || row.seq.length < 2) return null
  const st = Math.max(0.01, +stake || 1)
  const cap = Math.max(1, +capital || 10000)
  let bal = cap
  const pts = row.seq.map(w => { bal += w ? st * (payout - 1) : -st; return bal })
  const finalPnl = bal - cap
  const W = 900, H = 220, P = 28, n = pts.length
  const baseline = cap
  const mn = Math.min(baseline, ...pts), mx = Math.max(baseline, ...pts)
  const y = v => H - P - ((v - mn) / (mx - mn || 1)) * (H - 2 * P)
  const line = pts.map((v, i) => `${(i / (n - 1)) * (W - 2 * P) + P},${y(v)}`).join(' ')
  const baseY = y(baseline)
  // color segments: green above baseline, red below
  const pct = finalPnl / cap * 100
  return (
    <div>
      <div className="row">
        <b>{row.name}</b>
        <span>
          Capital: <b>${cap.toLocaleString()}</b> · Stake/trade: <b>${st}</b> · {n} trades ·&nbsp;
          Final: <b className={finalPnl >= 0 ? 'g' : 'r'}>${(cap + finalPnl).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b>&nbsp;
          (<b className={finalPnl >= 0 ? 'g' : 'r'}>{finalPnl >= 0 ? '+' : ''}{finalPnl.toFixed(2)} USD / {pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</b>)
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart">
        {/* baseline */}
        <line x1={P} x2={W - P} y1={baseY} y2={baseY} stroke="#2c3441" strokeDasharray="4 4" />
        {/* capital labels */}
        <text x={P} y={baseY - 5} fontSize="10" fill="#5d6878">${cap.toLocaleString()}</text>
        <polyline fill="none" stroke={finalPnl >= 0 ? '#1fd15a' : '#ff5555'} strokeWidth="1.8" points={line} />
        {/* max/min markers */}
        <text x={W - P} y={y(Math.max(...pts)) - 4} fontSize="10" fill="#1fd15a" textAnchor="end">${Math.max(...pts).toFixed(2)}</text>
        <text x={W - P} y={y(Math.min(...pts)) + 12} fontSize="10" fill="#ff5555" textAnchor="end">${Math.min(...pts).toFixed(2)}</text>
      </svg>
    </div>
  )
}

export default function Tester({ tabs, seed, demoBalance }) { // `seed` (optional) = preloaded ticks, used by tests
  const [sel, setSel] = useState(seed ? Object.keys(seed) : ['1HZ100V'])
  const [total, setTotal] = useState(5000)
  const [N, setN] = useState(5)
  const [payout, setPayout] = useState(1.95)
  const [delay, setDelay] = useState(0)
  const [one, setOne] = useState(true)
  const [view, setView] = useState('ALL')
  const [pick, setPick] = useState(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [err, setErr] = useState('')
  const [ver, setVer] = useState(0)
  const [capital, setCapital] = useState(() => demoBalance ?? 10000)
  const [stake, setStake] = useState(1)
  const data = useRef(seed || {})
  const reqId = useRef(100)

  const toggle = sy => setSel(s => (s.includes(sy) ? s.filter(x => x !== sy) : [...s, sy]))
  const pa = Math.max(1.01, +payout || 1.95)

  const load = async force => {
    if (!sel.length) return setErr('Select at least one market')
    setLoading(true); setErr('')
    let w
    try {
      w = await new Promise((res, rej) => { const s = new WebSocket(PUB); s.onopen = () => res(s); s.onerror = () => rej(new Error('Could not connect to Deriv')) })
      const ask = (req, ms = 15000) => new Promise((res, rej) => {
        const id = ++reqId.current
        const t = setTimeout(() => { w.removeEventListener('message', h); rej(new Error('Deriv did not answer (timeout)')) }, ms)
        const h = e => {
          const m = JSON.parse(e.data)
          if ((m.req_id ?? m.echo_req?.req_id) !== id) return
          clearTimeout(t); w.removeEventListener('message', h)
          m.error ? rej(new Error(m.error.message)) : res(m)
        }
        w.addEventListener('message', h)
        w.send(JSON.stringify({ ...req, req_id: id }))
      })
      for (const sy of sel) {
        if (!force && data.current[sy]?.px.length >= total) continue
        data.current[sy] = await loadTicks(ask, sy, total, s => setStatus(`${NAME[sy]}: ${s}`))
        await new Promise(r => setTimeout(r, 1500))
      }
      setVer(v => v + 1)
    } catch (e) { setErr(e.message) }
    finally { try { w?.close() } catch { /* ignore */ } setLoading(false); setStatus('') }
  }

  const per = useMemo(() => {
    const o = {}
    for (const sy of sel) { const d = data.current[sy]; if (d?.px?.length > 300) o[sy] = analyzeMarket(d.px.slice(-total), Math.max(1, +N || 5), +delay || 0, one) }
    return o
  }, [ver, sel, total, N, delay, one]) // eslint-disable-line react-hooks/exhaustive-deps
  const loaded = Object.keys(per)
  const rows = useMemo(() => summarize(view === 'ALL' ? Object.values(per) : per[view] ? [per[view]] : [], pa), [per, view, pa])
  const count = v => rows.filter(r => r.verdict === v).length
  const be = 1 / pa
  const pickRow = rows.find(r => r.name === pick) || null

  return (
    <div>
      <header className="top"><div className="brand"><img src="/logo.png" alt="" className="blogo" onError={e => { e.currentTarget.style.display = 'none' }} /><span className="by">By TradeXpertz</span></div></header>
      {tabs}
      <div className="tester">
        <div className="card">
          <b>🧪 Rise/Fall strategy tester</b>
          <p className="tnote">Downloads real Deriv ticks and replays {rows.length || 30} simple Rise/Fall strategies over them, one contract at a time like the live bot. Entry = first tick after the purchase, exit = the Nth tick (entry is tick 1), a tie loses. It shows each win rate with a 95% confidence range and compares it with the <b>break-even win rate ({(be * 100).toFixed(1)}%)</b> your payout needs. Because many strategies are tested, a result only counts as <b>🟢 Promising</b> after a multiple-testing correction AND when both halves of the data beat break-even. Expect almost everything to be ⚪ / 🔴 on random indices; that is the normal outcome, not a bug.</p>
          <label>Markets</label>
          <div className="tgrid">
            {MARKETS.map(([n, sy]) => <label key={sy} className="chk"><input type="checkbox" checked={sel.includes(sy)} onChange={() => toggle(sy)} /> {n}</label>)}
          </div>
          <div className="tctl" style={{ marginTop: 8 }}>
            <button className="mini" onClick={() => setSel(['1HZ100V'])}>V100 (1s) only</button>
            <button className="mini" onClick={() => setSel(MARKETS.slice(0, 5).map(m => m[1]))}>All 1s</button>
            <button className="mini" onClick={() => setSel(MARKETS.slice(5).map(m => m[1]))}>All normal</button>
            <button className="mini" onClick={() => setSel(MARKETS.map(m => m[1]))}>All 10</button>
          </div>
          <div className="tctl" style={{ marginTop: 12 }}>
            <div><label>Ticks per market</label>
              <select value={total} onChange={e => setTotal(+e.target.value)}>{[5000, 10000, 15000, 20000].map(v => <option key={v} value={v}>{v}</option>)}</select></div>
            <div><label>Contract length (ticks)</label><input type="number" min="1" max="10" value={N} onChange={e => setN(e.target.value)} /></div>
            <div><label>Payout multiple</label><input type="number" step="0.01" min="1.01" value={payout} onChange={e => setPayout(e.target.value)} /></div>
            <div><label>Delay (ticks) before buy</label>
              <select value={delay} onChange={e => setDelay(+e.target.value)}><option value={0}>0</option><option value={1}>1</option><option value={2}>2</option></select></div>
            <div style={{ gridColumn: '1/-1', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', background: '#12161c', border: '1px solid #2c3441', borderRadius: 8, padding: '10px 12px', marginTop: 4 }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={{ marginTop: 0 }}>💰 Wallet Capital (USD)</label>
                <input type="number" min="1" step="100" value={capital} onChange={e => setCapital(+e.target.value)} style={{ fontWeight: 700, fontSize: 15 }} />
              </div>
              <div style={{ flex: 1, minWidth: 140 }}>
                <label style={{ marginTop: 0 }}>🎯 Stake per trade (USD)</label>
                <input type="number" min="0.01" step="0.01" value={stake} onChange={e => setStake(+e.target.value)} />
              </div>
              <div style={{ flex: 2, minWidth: 200, fontSize: 12, color: '#8b95a5', paddingBottom: 4 }}>
                Break-even requires <b style={{ color: '#cfd8dc' }}>{(100 / pa).toFixed(1)}%</b> win rate.
                At <b style={{ color: '#cfd8dc' }}>${Math.max(0.01, +stake || 1)} / trade</b> you can sustain up to <b style={{ color: '#ff5555' }}>{Math.floor(Math.max(1, +capital || 10000) / Math.max(0.01, +stake || 1))} consecutive losses</b> before bust.
              </div>
            </div>
            <label className="chk"><input type="checkbox" checked={one} onChange={e => setOne(e.target.checked)} /> one contract at a time</label>
            <button className="tbtn" disabled={loading} onClick={() => load(false)}>{loading ? 'Loading…' : 'Load data & run'}</button>
            <button className="tbtn alt" disabled={loading} onClick={() => load(true)}>Reload data</button>
          </div>
          <p className="tnote muted">Payout multiple = what a winning 1.00 stake returns in total (check your 5-tick Rise/Fall payout in DTrader: payout ÷ stake). Delay 1 simulates a slow buy that lands a tick late (relevant on the 1s markets). Time estimate: about {Math.ceil((sel.length * total) / 5000 * 2.5)} s.</p>
          {status && <div className="qbadge g">⏳ {status}</div>}
          {err && <div className="qbadge r">❌ {err}</div>}
        </div>

        {loaded.length > 0 && (
          <div className="card">
            <div className="tctl">
              <div><label>Results for</label>
                <select style={{ width: 220 }} value={view} onChange={e => { setView(e.target.value); setPick(null) }}>
                  <option value="ALL">All loaded markets (pooled)</option>
                  {loaded.map(sy => <option key={sy} value={sy}>{NAME[sy]}</option>)}
                </select></div>
              <div className="tnote">🟢 {count('promising')} promising · ⚪ {count('noise')} noise · 🔴 {count('below')} below break-even · {count('few trades')} too few trades<br />
                {loaded.map(sy => `${NAME[sy]}: ${data.current[sy].px.slice(-total).length} ticks (${((data.current[sy].tm[data.current[sy].tm.length - 1] - data.current[sy].tm[Math.max(0, data.current[sy].tm.length - total)]) / 3600).toFixed(1)} h)`).join(' · ')}</div>
            </div>
            <div className="twrap">
              <table className="ttbl">
                <thead><tr><th>Strategy</th><th>Trades</th><th>Win %</th><th>95% range</th><th>Profit/trade @${Math.max(0.01,+stake||1)}</th><th>Est. total P&L</th><th>1st half</th><th>2nd half</th><th>Adj. p</th><th>Verdict</th></tr></thead>
                <tbody>
                  {rows.map(r => {
                    const st = Math.max(0.01, +stake || 1)
                    const profitPerTrade = r.ev * st
                    const totalPnl = profitPerTrade * r.n
                    return (
                    <tr key={r.name} className={pick === r.name ? 'sel' : ''} onClick={() => setPick(r.name)}>
                      <td>{r.name}<span className="grp">{r.group}</span></td>
                      <td>{r.n}</td>
                      <td className={r.p >= be ? 'g' : 'r'}><b>{(r.p * 100).toFixed(1)}%</b></td>
                      <td>{(r.lo * 100).toFixed(1)}–{(r.hi * 100).toFixed(1)}%</td>
                      <td className={profitPerTrade >= 0 ? 'g' : 'r'}>{profitPerTrade >= 0 ? '+' : ''}{profitPerTrade.toFixed(3)}</td>
                      <td className={totalPnl >= 0 ? 'g' : 'r'}><b>{totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}</b></td>
                      <td>{r.h1 == null ? '–' : `${(r.h1 * 100).toFixed(1)}%`}</td>
                      <td>{r.h2 == null ? '–' : `${(r.h2 * 100).toFixed(1)}%`}</td>
                      <td>{r.pAdj < 0.001 ? '<0.001' : r.pAdj.toFixed(3)}</td>
                      <td>{VERDICT[r.verdict]}</td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
            <p className="tnote muted">Profit/trade is at your chosen stake (${Math.max(0.01,+stake||1)}). Est. total P&L = profit/trade × number of trades — a rough simulation assuming fixed stake throughout. Adj. p = Bonferroni-corrected p-value. Click a row to see the full equity curve in real USD.</p>
            {pickRow && <Equity row={pickRow} payout={pa} capital={capital} stake={stake} />}
          </div>
        )}
      </div>
    </div>
  )
}
