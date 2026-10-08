import { useEffect, useRef, useState } from 'react'

const WS = 'wss://ws.derivws.com/websockets/v3?app_id=1089' // test app_id; register your own at api.deriv.com
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
  const [cfg, setCfg] = useState({ symbol: '1HZ100V', growth: 0.01, target: 2, wait: 0, stake: 1, maxLoss: 5, maxTrades: 20, token: '' })
  const [run, setRun] = useState(false)
  const [ticks, setTicks] = useState([])
  const [bar, setBar] = useState(null)
  const [acct, setAcct] = useState(null)
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
    r.since = 999; r.bar = null; setTicks([]); setBar(null)
    send({ ticks: c.symbol, subscribe: 1 })
    send({ proposal: 1, subscribe: 1, amount: +c.stake, basis: 'stake', contract_type: 'ACCU', currency: r.cur || 'USD', growth_rate: +c.growth, symbol: c.symbol })
  }

  useEffect(() => {
    const s = new WebSocket(WS); ws.current = s
    const r = R.current
    const buy = () => {
      if (!r.pid || r.open) return
      r.busy = true; r.selling = false
      send({ buy: r.pid, price: +C.current.stake })
    }
    const onTick = q => {
      const c = C.current
      setTicks(t => [...t.slice(-79), q])
      // 1) barrier hit detection (barriers belong to the previous tick's proposal)
      if (r.bar && (q >= r.bar.high || q <= r.bar.low)) r.since = 0
      else r.since = Math.min(r.since + 1, 999)
      // 2) strategy: enter when N ticks passed since last barrier hit
      const ok = RUN.current && !r.open && !r.busy && r.pnl > -c.maxLoss && r.n < c.maxTrades
      if (ok && r.since === +c.wait) setTimeout(buy, 400) // let the fresh proposal arrive
    }
    const onPoc = p => {
      const c = C.current
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
    s.onopen = () => { addLog('Connected'); subscribe() }
    s.onmessage = e => {
      const m = JSON.parse(e.data)
      if (m.error) { r.busy = false; addLog('❌ ' + m.error.message); return }
      switch (m.msg_type) {
        case 'authorize': r.cur = m.authorize.currency; setAcct(m.authorize); addLog('Logged in ' + m.authorize.loginid); subscribe(); break
        case 'tick': onTick(m.tick.quote); break
        case 'proposal': {
          const d = m.proposal.contract_details
          r.pid = m.proposal.id; r.bar = { high: +d.high_barrier, low: +d.low_barrier }; setBar(r.bar); break
        }
        case 'buy': r.open = m.buy.contract_id; r.busy = false; addLog(`🟢 Bought #${m.buy.contract_id}`)
          send({ proposal_open_contract: 1, contract_id: m.buy.contract_id, subscribe: 1 }); break
        case 'proposal_open_contract': onPoc(m.proposal_open_contract); break
        default:
      }
    }
    s.onclose = () => addLog('Disconnected')
    return () => s.close()
  }, [])

  useEffect(() => { if (ws.current?.readyState === 1) subscribe() }, [cfg.symbol, cfg.growth, cfg.stake])

  const login = () => cfg.token && send({ authorize: cfg.token.trim() })
  const set = k => e => setCfg({ ...cfg, [k]: e.target.value })
  const live = acct && !acct.is_virtual

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
        <label>API token (Read + Trade scope)</label>
        <input type="password" value={cfg.token} onChange={set('token')} placeholder="paste token — try DEMO first" />
        <button onClick={login} style={{ marginTop: 8, background: '#2a6' }}>Login</button>
        {acct && <div className="row"><span>{acct.loginid} {live ? '(REAL)' : '(demo)'}</span><span>{acct.balance} {acct.currency}</span></div>}
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
        <button className={run ? 'stop' : ''} disabled={!acct}
          onClick={() => { if (!run && live && !confirm('REAL account! Start auto trading?')) return; setRun(!run) }}>
          {run ? 'Stop bot' : 'Start bot'}
        </button>
      </div>
    </div>
  )
}
