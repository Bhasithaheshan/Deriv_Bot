// Differs Hunter session engine (plain JS, no React) so the whole flow can be unit-tested with a fake Deriv + fake clock.
// Plan: N runs, each run = ONE Digit Differs contract on ONE market (markets rotate run by run) whose barrier digit is the
// digit with the LOWEST share in that market's last 100 ticks. Optional Over 2 recovery (same system as Accumulator Hunter).

export const REQ = { RUN_PROP: 7001, RUN_BUY: 7002, REC_QUOTE: 7101, REC_BUY: 7102 }
const r2 = x => Math.round(x * 100) / 100
// Recovery steps alternate: 1 Over 2 (waits for 0-1-2 digits in a row), 2 Under 7 (waits for 7-8-9), 3 Over 2 ... each step on a different market.
export const KIND = {
  over: { type: 'DIGITOVER', barrier: '2', label: 'Over 2', dig: '0-1-2', word: 'low' },
  under: { type: 'DIGITUNDER', barrier: '7', label: 'Under 7', dig: '7-8-9', word: 'high' },
}

// digits = last 100 digits (0-9). Returns the digit that appeared least; ties -> the one not seen for the longest time.
export const pickDigit = digits => {
  const counts = new Array(10).fill(0), seen = new Array(10).fill(-1)
  digits.forEach((d, i) => { counts[d]++; seen[d] = i })
  const min = Math.min(...counts)
  let best = -1
  for (let d = 0; d < 10; d++) if (counts[d] === min && (best < 0 || seen[d] < seen[best])) best = d
  return { digit: best, share: min / digits.length, counts }
}

// cfg: { runs, ticks[], markets[], stake, tp, sl, rec:{on, mult, steps, maxStake, need, needOn, watch, digN} }
export const buildPlan = cfg => {
  const n = Math.max(1, Math.min(10, +cfg.runs || 1)), mk = cfg.markets.length ? cfg.markets : []
  return {
    runs: Array.from({ length: n }, (_, i) => ({ ticks: Math.max(1, Math.min(10, Math.round(+cfg.ticks[i]) || 5)), sy: mk[i % mk.length] })),
    stake: +cfg.stake, tp: +cfg.tp || 0, sl: +cfg.sl || 0,
    rec: { on: !!cfg.rec.on, mult: +cfg.rec.mult || 3, steps: Math.max(1, +cfg.rec.steps || 3), maxStake: +cfg.rec.maxStake || 30, needOn: cfg.rec.needOn !== false, need: Math.max(1, Math.min(5, +cfg.rec.need || 2)), watch: Math.max(0.1, +cfg.rec.watch || 2), digN: Math.max(100, +cfg.rec.digN || 500) },
  }
}

export class DiffersEngine {
  constructor(d) {
    this.send = d.send; this.feed = d.feed; this.log = d.log || (() => {}); this.emit = d.emit || (() => {})
    this.cur = d.cur || (() => 'USD'); this.names = d.names || {}; this.allSyms = d.allSyms || []
    this.set = d.set || ((f, ms) => setTimeout(f, ms)); this.clear = d.clear || (id => clearTimeout(id))
    this.phase = 'idle'; this.timers = []
  }
  name(sy) { return this.names[sy] || sy }

  start(plan) {
    this.plan = plan; this.phase = 'running'; this.stage = 'idle'; this.idx = 0; this.pnl = 0; this.w = 0; this.l = 0; this.reason = ''
    this.rows = plan.runs.map(r => ({ sy: r.sy, ticks: r.ticks, status: 'waiting', digit: null, share: null, profit: null, recs: [] }))
    this.recDone = {}; this.recFail = 0; this.rec = null; this.cid = null; this.fails = 0; this.waitFeed = 0
    this.log(`▶ Session started — ${plan.runs.length} runs, stake ${plan.stake}, recovery ${plan.rec.on ? 'ON' : 'OFF'}`)
    this._next(); this.emit()
  }
  stop(why = 'Stopped by you') { this._finish(why) }

  _later(ms, fn) { const id = this.set(() => { if (this.phase === 'running') fn() }, ms); this.timers.push(id); return id }
  _watch(ms, msg) { this.clear(this.wd); this.wd = this.set(() => this._finish(typeof msg === 'function' ? msg() : msg), ms) }
  _finish(why, recoveryFailed) {
    if (this.phase !== 'running') return
    if (this.rec) {
      this.recFail++
      if (this.rec.subId) this.send({ forget: this.rec.subId })
    }
    this.timers.forEach(this.clear); this.clear(this.wd); this.clear(this.hop)
    this.phase = 'done'; this.reason = why; this.rec = null; this.stage = 'idle'
    this.rows.forEach(r => { if (r.status === 'active' || r.status === 'trading') r.status = 'stopped' })
    this.log(why); this.emit()
  }

  _next() {
    if (this.phase !== 'running') return
    if (this.idx >= this.plan.runs.length) return this._finish(`✅ Session complete — ${this.w} wins, ${this.l} losses, P/L ${this.pnl >= 0 ? '+' : ''}${this.pnl.toFixed(2)}`)
    this.rows[this.idx].status = 'active'; this.fails = 0; this.waitFeed = 0
    this._prepare(); this.emit()
  }

  _prepare() {
    if (this.phase !== 'running') return
    const run = this.plan.runs[this.idx], row = this.rows[this.idx]
    const digits = this.feed.lastDigits(run.sy, 100)
    if (!digits) {
      this.waitFeed++
      if (this.waitFeed === 1) this.log(`⏳ Run ${this.idx + 1}: waiting for ${this.name(run.sy)} tick data…`)
      if (this.waitFeed > 90) return this._finish(`⚠️ No tick data for ${this.name(run.sy)} — session stopped`)
      this.stage = 'feed'; this._later(1000, () => this._prepare()); return
    }
    const pk = pickDigit(digits)
    row.digit = pk.digit; row.share = pk.share; this.stage = 'prop'
    this.log(`🎯 Run ${this.idx + 1}/${this.plan.runs.length}: ${this.name(run.sy)} · Differs ${pk.digit} (${Math.round(pk.share * 100)}% in the last 100 ticks) · ${run.ticks} ticks · stake ${this.plan.stake}`)
    this.send({ proposal: 1, amount: this.plan.stake, basis: 'stake', contract_type: 'DIGITDIFF', barrier: String(pk.digit), duration: run.ticks, duration_unit: 't', currency: this.cur(), underlying_symbol: run.sy, req_id: REQ.RUN_PROP })
    this._watch(20000, `⚠️ No quote from Deriv for run ${this.idx + 1} — session stopped`)
    this.emit()
  }

  onMessage(m) {
    if (this.phase !== 'running') return
    const id = m.req_id ?? m.echo_req?.req_id
    if (m.error) return this._onError(m, id)
    const rec = this.rec
    if (id === REQ.RUN_PROP && this.stage === 'prop' && m.proposal?.id) {
      this.stage = 'buy'; this.send({ buy: m.proposal.id, price: this.plan.stake, req_id: REQ.RUN_BUY })
      this._watch(20000, `⚠️ No buy confirmation for run ${this.idx + 1} — session stopped. Check your positions.`)
    } else if (id === REQ.RUN_BUY && this.stage === 'buy' && m.buy) {
      this.cid = m.buy.contract_id; this.stage = 'open'; this.rows[this.idx].status = 'trading'
      this.send({ proposal_open_contract: 1, contract_id: this.cid, subscribe: 1 })
      this._watch(this.rows[this.idx].ticks * 3000 + 30000, `⚠️ No result from Deriv for run ${this.idx + 1} — session stopped. Check your positions.`)
      this.emit()
    } else if (id === REQ.REC_QUOTE && m.proposal) {
      const e = m.echo_req || {}
      if (rec && rec.stage === 'wait' && e.underlying_symbol === rec.sym && +e.amount === rec.stake) {
        rec.q = { pid: m.proposal.id }; rec.subId = m.subscription?.id || rec.subId
        if (rec.go) this._fire()
      } else if (m.subscription?.id) this.send({ forget: m.subscription.id }) // stale quote stream
    } else if (id === REQ.REC_BUY && rec && rec.stage === 'buy' && m.buy) {
      rec.cid = m.buy.contract_id; rec.stage = 'open'
      this.log(`🎲 ${KIND[rec.kind].label} bought on ${rec.name} (stake ${rec.stake.toFixed(2)})`)
      this.send({ proposal_open_contract: 1, contract_id: rec.cid, subscribe: 1 })
      this._watch(30000, `⚠️ No result for the ${KIND[rec.kind].label} trade — session stopped. Debt ≈ ${rec.debt.toFixed(2)}`)
      this.emit()
    } else if (m.msg_type === 'proposal_open_contract' && m.proposal_open_contract?.is_sold) {
      const p = m.proposal_open_contract
      if (this.stage === 'open' && p.contract_id === this.cid) this._runResult(p)
      else if (rec && rec.stage === 'open' && p.contract_id === rec.cid) this._recResult(p)
    }
  }

  _onError(m, id) {
    const msg = m.error.message || JSON.stringify(m.error), rec = this.rec
    if (id === REQ.RUN_PROP || id === REQ.RUN_BUY) {
      this.fails++; this.clear(this.wd)
      if (this.fails <= 3) { this.log(`⚠️ ${msg} — retrying (${this.fails}/3)`); this.stage = 'retry'; this._later(2500, () => this._prepare()); return }
      this.log(`❌ Run ${this.idx + 1} skipped: ${msg}`)
      this.rows[this.idx].status = 'skipped'; this.idx++; this.stage = 'idle'; this._later(300, () => this._next()); this.emit(); return
    }
    if ((id === REQ.REC_BUY) && rec && rec.stage === 'buy' && (rec.fails || 0) < 3) {
      rec.fails = (rec.fails || 0) + 1
      this.log(`⚠️ ${KIND[rec.kind].label} buy failed (${msg}) — waiting for the next pattern (${rec.fails}/3)`)
      rec.stage = 'wait'; rec.q = null; rec.subId = null; this._watch(this._recWaitMs(), () => this._noPattern()); this._focus(rec.idx || 0); return
    }
    if (id === REQ.REC_QUOTE || id === REQ.REC_BUY) return this._finish(`❌ ${rec && rec.kind ? KIND[rec.kind].label : 'Recovery trade'} failed: ${msg} — session stopped. Debt ≈ ${rec ? rec.debt.toFixed(2) : '?'}`)
    this.log('❌ ' + msg)
  }

  _runResult(p) {
    this.clear(this.wd)
    const profit = +p.profit, i = this.idx, row = this.rows[i]
    this.pnl += profit; if (profit > 0) this.w++; else this.l++
    row.status = profit > 0 ? 'win' : 'loss'; row.profit = profit
    this.log(`${profit > 0 ? '✅ Run ' + (i + 1) + ' WIN' : '🔴 Run ' + (i + 1) + ' LOSS'}  ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`)
    this.idx++; this.stage = 'idle'; this.cid = null
    const { tp, sl, rec } = this.plan
    if (tp > 0 && this.pnl >= tp) return this._finish(`🎯 Take profit reached (+${this.pnl.toFixed(2)}) — session ended`)
    if (sl > 0 && this.pnl <= -sl) return this._finish(`⛔ Stop loss reached (${this.pnl.toFixed(2)}) — session ended`)
    if (profit <= 0 && rec.on) { this._startRecovery(-profit, i); this.emit(); return }
    this._later(400, () => this._next()); this.emit()
  }

  // ---------------- Over 2 recovery (same system as Accumulator Hunter) ----------------
  _run(kind, sy) { return kind === 'under' ? this.feed.highRun(sy) : this.feed.lowRun(sy) } // digits of the wanted group in a row
  _recWaitMs() { const n = (this.rec && this.rec.order ? this.rec.order.length : 5) || 5; return Math.max(5, n * this.plan.rec.watch + 1) * 60000 }
  _noPattern() { return `⏱ No digit pattern within ${Math.round(this._recWaitMs() / 60000)} minutes — session stopped. Debt ≈ ${this.rec ? this.rec.debt.toFixed(2) : '?'}` }
  _startRecovery(loss, row) { this.rec = { debt: loss, stake: r2(loss * this.plan.rec.mult), step: 1, row, used: [], kind: 'over' }; this._recPlace() }
  _recPlace() {
    const c = this.plan.rec, rec = this.rec
    if (rec.step > c.steps) return this._finish(`⛔ Recovery steps limit (${c.steps}) reached — session stopped. Debt ≈ ${rec.debt.toFixed(2)}`)
    if (rec.stake > c.maxStake) return this._finish(`⛔ Recovery stake ${rec.stake.toFixed(2)} is above the cap (${c.maxStake}) — session stopped. Debt ≈ ${rec.debt.toFixed(2)}`)
    rec.kind = rec.step % 2 === 1 ? 'over' : 'under'; const K = KIND[rec.kind]
    const share = sy => (rec.kind === 'under' ? this.feed.p789(sy, c.digN) : this.feed.p012(sy, c.digN))
    const all = this.allSyms.map(sy => ({ sy, name: this.name(sy), p: share(sy) })).filter(x => x.p != null).sort((a, b) => a.p - b.p) // fewest digits of the group first
    let order = all.filter(x => !rec.used.includes(x.sy)) // never a market used by an earlier step
    if (!order.length) { rec.used = []; order = all } // every market used: start over
    if (!order.length) return this._finish('⚠️ No digit statistics yet for recovery — session stopped')
    rec.order = order; rec.stage = 'wait'; rec.fails = 0; rec.go = false; rec.q = null; rec.subId = null
    this.log(`🎲 Recovery step ${rec.step}: ${K.label} stake ${rec.stake.toFixed(2)} — need ${c.need} ${K.word} digits (${K.dig}) in a row, ${c.watch} min per market, new market each step, order: ${order.map(o => `${o.name.replace(' Index', '')} ${(o.p * 100).toFixed(0)}%`).join(' → ')}`)
    this._watch(this._recWaitMs(), () => this._noPattern())
    this._focus(0)
  }
  _focus(i) {
    const rec = this.rec, c = this.plan.rec
    if (!rec || rec.stage !== 'wait') return
    this.clear(this.hop)
    if (rec.subId) this.send({ forget: rec.subId })
    const o = rec.order[i]; rec.idx = i; rec.sym = o.sy; rec.name = o.name; rec.go = false; rec.q = null; rec.subId = null
    this.send({ proposal: 1, subscribe: 1, amount: rec.stake, basis: 'stake', contract_type: KIND[rec.kind].type, barrier: KIND[rec.kind].barrier, duration: 1, duration_unit: 't', currency: this.cur(), underlying_symbol: rec.sym, req_id: REQ.REC_QUOTE })
    if (this._run(rec.kind, rec.sym) >= c.need || !c.needOn) rec.go = true // the pattern is already there (or digit-wait is OFF): buy as soon as the quote arrives
    this.hop = this.set(() => { if (this.rec === rec && rec.stage === 'wait' && this.phase === 'running') this._focus((rec.idx + 1) % rec.order.length) }, Math.max(5000, c.watch * 60000))
    this.emit()
  }
  onTick(sy) { // called by the feed for every live tick of every market
    const rec = this.rec
    if (this.phase !== 'running' || !rec || rec.stage !== 'wait' || rec.sym !== sy) return
    if (this._run(rec.kind, sy) >= this.plan.rec.need || !this.plan.rec.needOn) { rec.go = true; this._fire() }
    this.emit()
  }
  _fire() {
    const rec = this.rec
    if (!rec || rec.stage !== 'wait' || !rec.q || !rec.q.pid) return // fires as soon as the quote arrives (rec.go stays true)
    rec.stage = 'buy'; rec.go = false; rec.used = [...rec.used, rec.sym]; this.clear(this.hop)
    this._watch(25000, `⚠️ No buy confirmation for the ${KIND[rec.kind].label} trade — session stopped. Debt ≈ ${rec.debt.toFixed(2)}`)
    this.send({ buy: rec.q.pid, price: rec.stake, req_id: REQ.REC_BUY })
    if (rec.subId) this.send({ forget: rec.subId }); rec.subId = null
    this.log(`⚡ ${this._run(rec.kind, rec.sym)} ${KIND[rec.kind].word} digits (${KIND[rec.kind].dig}) in a row on ${rec.name} → buying ${KIND[rec.kind].label} now`)
    this.emit()
  }
  _recResult(p) {
    this.clear(this.wd)
    const rec = this.rec, c = this.plan.rec, profit = +p.profit
    this.pnl += profit
    this.rows[rec.row].recs.push({ step: rec.step, label: KIND[rec.kind].label, name: rec.name, stake: rec.stake, profit })
    this.log(`${profit > 0 ? '✅ ' : '🔴 '}${KIND[rec.kind].label} ${profit > 0 ? 'WIN' : 'LOSS'}  ${profit >= 0 ? '+' : ''}${profit.toFixed(2)}`)
    if (profit > 0) rec.debt -= profit; else rec.debt += rec.stake
    if (profit > 0 && rec.debt <= 0.005) { // recovered -> back to the normal runs
      this.recDone[rec.step] = (this.recDone[rec.step] || 0) + 1
      this.log(`✅ Loss recovered at step ${rec.step} — continuing with the next run`)
      this.rec = null
      if (this.plan.tp > 0 && this.pnl >= this.plan.tp) return this._finish(`🎯 Take profit reached (+${this.pnl.toFixed(2)}) — session ended`)
      this._later(400, () => this._next()); this.emit(); return
    }
    if (this.plan.sl > 0 && this.pnl <= -this.plan.sl) return this._finish(`⛔ Stop loss reached during recovery (${this.pnl.toFixed(2)}) — session ended. Debt ≈ ${rec.debt.toFixed(2)}`)
    rec.stake = profit > 0 ? r2(c.mult * rec.debt) : r2(rec.stake * c.mult); rec.step++
    this._recPlace()
  }

  statusText() {
    const n = this.plan ? this.plan.runs.length : 0
    if (this.phase === 'done') return this.reason
    if (this.rec) {
      const r = this.rec
      return r.stage === 'wait' ? `Recovery step ${r.step}/${this.plan.rec.steps} · watching ${r.name} (${(r.idx || 0) + 1}/${(r.order || []).length}) for ${this.plan.rec.need} ${KIND[r.kind].word} digits in a row`
        : `Recovery step ${r.step}/${this.plan.rec.steps} · ${KIND[r.kind].label} ${r.stage === 'open' ? 'running' : 'buying'} on ${r.name}`
    }
    const row = this.rows && this.rows[Math.min(this.idx, n - 1)]
    const label = { feed: 'waiting for tick data', prop: 'getting a quote', retry: 'retrying', buy: 'buying', open: 'trading', idle: 'preparing' }[this.stage] || ''
    return `Run ${Math.min(this.idx + 1, n)} of ${n} · ${label}${row && row.digit != null ? ` · Differs ${row.digit}` : ''}`
  }
  snapshot() {
    return { phase: this.phase, status: this.statusText(), idx: this.idx, total: this.plan ? this.plan.runs.length : 0, rows: this.rows.map(r => ({ ...r, recs: [...r.recs] })), pnl: this.pnl, w: this.w, l: this.l, reason: this.reason, recOn: this.plan.rec.on, rec: this.rec ? { step: this.rec.step, debt: this.rec.debt, stake: this.rec.stake, name: this.rec.name, stage: this.rec.stage, pos: (this.rec.idx || 0) + 1, total: (this.rec.order || []).length, kind: this.rec.kind, label: KIND[this.rec.kind].label, seq: this.rec.sym ? this._run(this.rec.kind, this.rec.sym) : 0, need: this.plan.rec.need, tape: this.rec.sym ? this.feed.tape(this.rec.sym).slice(-8) : [] } : null, recDone: { ...this.recDone }, recFail: this.recFail }
  }
}
