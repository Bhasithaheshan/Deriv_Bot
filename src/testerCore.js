// Pure functions for the Rise/Fall strategy tester (no React, no network) so they can be unit-tested.

export const phi = z => { // standard normal CDF (Abramowitz-Stegun)
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp((-z * z) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

export const wilson = (w, n) => { // 95% confidence interval for a win rate
  if (!n) return [0, 0]
  const z = 1.96, p = w / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n)
  const a = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [(c - a) / d, (c + a) / d]
}

const ema = (px, k) => { const a = 2 / (k + 1), o = new Array(px.length); o[0] = px[0]; for (let i = 1; i < px.length; i++) o[i] = a * px[i] + (1 - a) * o[i - 1]; return o }

const rollingZ = (px, k) => { // z-score of price vs its last k ticks (prefix sums on detrended prices for numeric stability)
  const n = px.length, y = px.map(v => v - px[0]), s = [0], s2 = [0]
  for (let i = 0; i < n; i++) { s.push(s[i] + y[i]); s2.push(s2[i] + y[i] * y[i]) }
  const z = new Array(n).fill(0)
  for (let i = k; i < n; i++) {
    const m = (s[i + 1] - s[i + 1 - k]) / k, v = (s2[i + 1] - s2[i + 1 - k]) / k - m * m
    z[i] = v > 1e-12 ? (y[i] - m) / Math.sqrt(v) : 0
  }
  return z
}

const rsi = (px, k = 14) => { // Wilder RSI
  const n = px.length, o = new Array(n).fill(50)
  let g = 0, l = 0
  for (let i = 1; i < n; i++) {
    const d = px[i] - px[i - 1], up = d > 0 ? d : 0, dn = d < 0 ? -d : 0
    if (i <= k) { g += up / k; l += dn / k } else { g = (g * (k - 1) + up) / k; l = (l * (k - 1) + dn) / k }
    if (i >= k) o[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l)
  }
  return o
}

// A signal returns +1 (buy Rise), -1 (buy Fall) or 0 (no trade) using ONLY ticks up to and including index i.
export const buildStrategies = px => {
  const n = px.length
  const d = px.map((v, i) => (i ? v - px[i - 1] : 0))
  const up = new Int32Array(n), dn = new Int32Array(n)
  for (let i = 1; i < n; i++) { up[i] = d[i] > 0 ? up[i - 1] + 1 : 0; dn[i] = d[i] < 0 ? dn[i - 1] + 1 : 0 }
  const sgn = v => (v > 0 ? 1 : v < 0 ? -1 : 0)
  const E = { 5: ema(px, 5), 10: ema(px, 10), 20: ema(px, 20), 50: ema(px, 50) }
  const z20 = rollingZ(px, 20), rs = rsi(px, 14)
  const ad = [0]; for (let i = 0; i < n; i++) ad.push(ad[i] + Math.abs(d[i]))
  const avgAbs = i => (i >= 21 ? (ad[i] - ad[i - 20]) / 20 : 0) // mean |move| of the 20 ticks BEFORE tick i
  const L = []
  const add = (group, name, sig) => L.push({ group, name, sig })
  add('Baseline', 'Always Rise', () => 1)
  add('Baseline', 'Always Fall', () => -1)
  for (const k of [2, 3, 4, 5]) {
    add('Momentum', `${k} ticks in a row → follow`, i => (up[i] >= k ? 1 : dn[i] >= k ? -1 : 0))
    add('Reversal', `${k} ticks in a row → fade`, i => (up[i] >= k ? -1 : dn[i] >= k ? 1 : 0))
  }
  for (const M of [3, 5, 10, 20]) {
    add('Trend', `Price vs ${M} ticks ago → follow`, i => sgn(px[i] - px[i - M]))
    add('Trend', `Price vs ${M} ticks ago → fade`, i => -sgn(px[i] - px[i - M]))
  }
  for (const [f, s] of [[5, 20], [10, 50]]) {
    add('EMA', `EMA${f}/EMA${s} → follow`, i => sgn(E[f][i] - E[s][i]))
    add('EMA', `EMA${f}/EMA${s} → fade`, i => -sgn(E[f][i] - E[s][i]))
  }
  for (const t of [1.5, 2]) {
    add('Z-score', `Z(20) beyond ±${t} → fade`, i => (z20[i] > t ? -1 : z20[i] < -t ? 1 : 0))
    add('Z-score', `Z(20) beyond ±${t} → follow`, i => (z20[i] > t ? 1 : z20[i] < -t ? -1 : 0))
  }
  add('RSI', 'RSI(14) >70 / <30 → fade', i => (rs[i] > 70 ? -1 : rs[i] < 30 ? 1 : 0))
  add('RSI', 'RSI(14) >70 / <30 → follow', i => (rs[i] > 70 ? 1 : rs[i] < 30 ? -1 : 0))
  add('Big move', 'Move > 2.5× avg → fade', i => (avgAbs(i) > 0 && Math.abs(d[i]) > 2.5 * avgAbs(i) ? -sgn(d[i]) : 0))
  add('Big move', 'Move > 2.5× avg → follow', i => (avgAbs(i) > 0 && Math.abs(d[i]) > 2.5 * avgAbs(i) ? sgn(d[i]) : 0))
  return L
}

// Rise/Fall, duration N ticks: entry spot = first tick after the purchase, exit spot = the Nth tick (entry is tick 1).
// Win only if strictly higher (Rise) / strictly lower (Fall). delay = extra ticks lost between signal and purchase.
export const backtest = (px, sig, N, delay, oneAtATime) => {
  const n = px.length, wins = [], at = []
  let i = 60
  while (i < n) {
    const s = sig(i)
    if (s !== 0) {
      const e = i + 1 + delay, x = e + (N - 1)
      if (x >= n) break
      wins.push((s > 0 ? px[x] > px[e] : px[x] < px[e]) ? 1 : 0); at.push(i)
      i = oneAtATime ? x : i + 1 // one contract at a time like the live bot: next decision after the exit tick
    } else i++
  }
  return { wins, at }
}

export const analyzeMarket = (px, N, delay, oneAtATime) => {
  const out = {}, half = px.length / 2
  for (const s of buildStrategies(px)) {
    const { wins, at } = backtest(px, s.sig, N, delay, oneAtATime)
    const r = { group: s.group, n: wins.length, w: 0, h1w: 0, h1n: 0, h2w: 0, h2n: 0, seq: wins }
    wins.forEach((w, j) => { r.w += w; if (at[j] < half) { r.h1n++; r.h1w += w } else { r.h2n++; r.h2w += w } })
    out[s.name] = r
  }
  return out
}

// payout = total return multiple on a win (1.95 -> profit 0.95 per 1 staked). Break-even win rate = 1 / payout.
export const summarize = (perMarkets, payout) => {
  const acc = {}
  for (const per of perMarkets) for (const [name, r] of Object.entries(per)) {
    const a = (acc[name] ||= { name, group: r.group, n: 0, w: 0, h1n: 0, h1w: 0, h2n: 0, h2w: 0, seq: [] })
    a.n += r.n; a.w += r.w; a.h1n += r.h1n; a.h1w += r.h1w; a.h2n += r.h2n; a.h2w += r.h2w; a.seq = a.seq.concat(r.seq)
  }
  const be = 1 / payout, m = Object.keys(acc).length
  return Object.values(acc).map(a => {
    const p = a.n ? a.w / a.n : 0, [lo, hi] = wilson(a.w, a.n)
    const z = a.n ? (p - be) / Math.sqrt((be * (1 - be)) / a.n) : 0
    const pAdj = Math.min(1, (1 - phi(z)) * m) // one-sided p-value, Bonferroni-corrected for the number of strategies tested
    const h1 = a.h1n ? a.h1w / a.h1n : null, h2 = a.h2n ? a.h2w / a.h2n : null
    let verdict
    if (a.n < 300) verdict = 'few trades'
    else if (pAdj < 0.05 && h1 >= be && h2 >= be) verdict = 'promising'
    else if (p >= be) verdict = 'noise'
    else verdict = 'below'
    return { ...a, p, lo, hi, be, ev: p * payout - 1, h1, h2, pAdj, verdict }
  }).sort((x, y) => y.ev - x.ev)
}

// Downloads up to `total` ticks (newest first, paging backwards 5000 at a time). `ask(request)` must resolve with the Deriv reply.
export const loadTicks = async (ask, sym, total, onStatus, nap = ms => new Promise(r => setTimeout(r, ms))) => {
  let px = [], tm = [], end = 'latest'
  while (px.length < total) {
    const count = Math.min(5000, total - px.length)
    let m
    for (let a = 0; ; a++) {
      try { m = await ask({ ticks_history: sym, end, count, style: 'ticks' }); break }
      catch (e) {
        if (/rate limit/i.test(e.message) && a < 4) { onStatus?.('rate limit — waiting 15 s…'); await nap(15000); continue }
        throw e
      }
    }
    const h = m.history
    if (!h?.prices?.length) break
    const p = h.prices.map(Number), t = h.times.map(Number)
    px = p.concat(px); tm = t.concat(tm)
    onStatus?.(`${px.length}/${total} ticks`)
    if (p.length < count) break
    end = t[0] - 1
    await nap(1500)
  }
  return { px, tm }
}
