import { useEffect, useMemo, useRef, useState } from 'react'

// Live last-digit feed for several markets over its own public socket: history (500 ticks) + live ticks.
// Requests go out one at a time (rate limits) and are retried. Exposes the small interface the Differs engine needs.
const PUB = 'wss://api.derivws.com/trading/v1/options/ws/public'
const decimals = v => { const t = String(v); const i = t.indexOf('.'); return i < 0 ? 0 : t.length - i - 1 }
const digitOf = (d, v) => +v.toFixed(d.pip != null ? d.pip : d.pipInf != null ? d.pipInf : decimals(v)).slice(-1)

export function useDigitFeed(syms, onTick) {
  const F = useRef({})
  const cb = useRef(onTick); cb.current = onTick
  const [ver, setVer] = useState(0)
  const key = syms.join(',')

  useEffect(() => {
    const D = F.current
    syms.forEach(sy => { D[sy] = D[sy] || { px: [], t: 0, pip: null, pipInf: null, low: 0, high: 0, tape: [], sub: false } })
    let dead = false, w = null, cur = null, timer = null, hold = 0, recon = null
    let q = [], queued = new Set()
    const send1 = o => { if (w && w.readyState === 1) w.send(JSON.stringify(o)) }
    const pump = () => {
      if (dead || cur || !w || w.readyState !== 1 || Date.now() < hold) return
      const sy = q.shift(); if (!sy) return
      cur = sy
      send1({ ticks_history: sy, end: 'latest', count: 500, style: 'ticks', subscribe: 1 })
      timer = setTimeout(() => finish(sy, false), 8000)
    }
    const finish = (sy, rateLimited) => {
      if (cur !== sy) return
      clearTimeout(timer); queued.delete(sy); cur = null
      if (rateLimited) hold = Date.now() + 15000
      setTimeout(pump, rateLimited ? 15000 : 1500) // history is the heavy request: keep a gap
    }
    const fill = () => syms.forEach(sy => { if (!D[sy].sub && !queued.has(sy)) { queued.add(sy); q.push(sy) } })
    const open = () => {
      w = new WebSocket(PUB)
      w.onopen = () => { syms.forEach(sy => { D[sy].sub = false }); q = []; queued = new Set(); cur = null; fill(); pump() }
      w.onmessage = e => {
        let m; try { m = JSON.parse(e.data) } catch { return }
        const er = m.echo_req || {}
        if (m.error) {
          const sy = er.ticks_history
          if (sy && D[sy]) {
            if (/already subscribed/i.test(m.error.message || '')) { D[sy].sub = true; finish(sy, false) }
            else finish(sy, /rate limit/i.test(m.error.message || ''))
          }
          return
        }
        if (m.msg_type === 'history' || m.msg_type === 'ticks_history') {
          const sy = er.ticks_history, d = D[sy]
          if (d && m.history?.prices) {
            if (m.pip_size != null) d.pip = +m.pip_size
            d.px = m.history.prices.map(Number).slice(-1000); d.t = +m.history.times[m.history.times.length - 1]
            d.pipInf = Math.max(...d.px.map(decimals))
            const dg = d.px.slice(-14).map(v => digitOf(d, v)); let run = 0
            for (let i = dg.length - 1; i >= 0 && dg[i] <= 2; i--) run++
            let hrun = 0; for (let i = dg.length - 1; i >= 0 && dg[i] >= 7; i--) hrun++
            d.low = run; d.high = hrun; d.tape = dg.slice(-12); d.sub = true
            finish(sy, false)
          }
        } else if (m.msg_type === 'tick') {
          const sy = er.ticks_history || er.ticks || m.tick.symbol, d = D[sy]
          if (d && m.tick.epoch > d.t) {
            if (m.tick.pip_size != null) d.pip = +m.tick.pip_size
            d.t = m.tick.epoch; d.px.push(+m.tick.quote); if (d.px.length > 1000) d.px.shift()
            const dg = digitOf(d, +m.tick.quote)
            d.low = dg <= 2 ? d.low + 1 : 0; d.high = dg >= 7 ? d.high + 1 : 0; d.tape = [...d.tape.slice(-11), dg]
            cb.current?.(sy, dg)
          }
        }
      }
      w.onclose = () => { if (dead) return; cur = null; clearTimeout(timer); recon = setTimeout(open, 3000) }
    }
    open()
    const iv = setInterval(() => setVer(v => v + 1), 1000)
    const retry = setInterval(() => { fill(); pump() }, 8000)
    const ping = setInterval(() => send1({ ping: 1 }), 30000)
    return () => { dead = true; clearInterval(iv); clearInterval(retry); clearInterval(ping); clearTimeout(timer); clearTimeout(recon); if (w) { w.onclose = null; w.close() } }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const feed = useMemo(() => ({
    lastDigits: (sy, n) => { const d = F.current[sy]; if (!d || d.px.length < n) return null; return d.px.slice(-n).map(v => digitOf(d, v)) },
    p012: (sy, n) => { const d = F.current[sy]; if (!d || d.px.length < 100) return null; const a = d.px.slice(-n); let c = 0; for (const v of a) if (digitOf(d, v) <= 2) c++; return c / a.length },
    p789: (sy, n) => { const d = F.current[sy]; if (!d || d.px.length < 100) return null; const a = d.px.slice(-n); let c = 0; for (const v of a) if (digitOf(d, v) >= 7) c++; return c / a.length },
    lowRun: sy => (F.current[sy] ? F.current[sy].low : 0),
    highRun: sy => (F.current[sy] ? F.current[sy].high : 0),
    tape: sy => (F.current[sy] ? F.current[sy].tape : []),
  }), [])
  return { feed, ver }
}
