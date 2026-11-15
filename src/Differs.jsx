import { useEffect, useMemo, useRef, useState } from 'react'
import { AccountBar, useDeriv } from './deriv.jsx'
import { useDigitFeed } from './digitFeed.js'
import { DiffersEngine, buildPlan, pickDigit } from './differsEngine.js'

const SYMS = ['1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V']
const NAME = { '1HZ10V': 'Volatility 10 (1s) Index', '1HZ25V': 'Volatility 25 (1s) Index', '1HZ50V': 'Volatility 50 (1s) Index', '1HZ75V': 'Volatility 75 (1s) Index', '1HZ100V': 'Volatility 100 (1s) Index' }
const SHORT = sy => NAME[sy].replace('Volatility ', 'V').replace(' Index', '')
const DEF = { runs: 5, ticks: Array(10).fill(5), mk: [...SYMS], stake: 1, tp: 3, sl: 5, rec: { on: false, mult: 3, steps: 3, maxStake: 30, need: 2, needOn: true, watch: 2, digN: 500 } }
const loadCfg = () => {
  try { const s = JSON.parse(localStorage.getItem('diffCfg')); return s ? { ...DEF, ...s, ticks: [...(s.ticks || []), ...DEF.ticks].slice(0, 10), rec: { ...DEF.rec, ...(s.rec || {}) } } : DEF } catch { return DEF }
}
const money = v => `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}`

export default function Differs({ tabs, seed }) { // `seed` (optional) = {phase, snap}, used by tests
  const [cfg, setCfg] = useState(loadCfg)
  const [phase, setPhase] = useState(seed?.phase || 'setup') // setup -> run
  const [snap, setSnap] = useState(seed?.snap || null)
  const [log, setLog] = useState([])
  const addLog = t => setLog(l => [new Date().toLocaleTimeString() + '  ' + t, ...l].slice(0, 80))
  const dv = useDeriv(addLog)
  const eng = useRef(null)
  const lastPlan = useRef(null) // plan of the last session, for "Restart, same settings"
  const { feed, ver } = useDigitFeed(SYMS, (sy, d) => eng.current?.onTick(sy, d))

  useEffect(() => {
    dv.setOnMessage(m => eng.current?.onMessage(m))
    dv.setOnClose(() => { if (eng.current?.phase === 'running') eng.current.stop('⚠️ Trading connection lost — session stopped') })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem('diffCfg', JSON.stringify(cfg)) } catch { /* ignore */ } }, [cfg])
  useEffect(() => { window.__botRunning = snap?.phase === 'running'; return () => { window.__botRunning = false } }, [snap?.phase])

  const upd = (k, v) => setCfg(c => ({ ...c, [k]: v }))
  const updRec = (k, v) => setCfg(c => ({ ...c, rec: { ...c.rec, [k]: v } }))
  const setTick = (i, v) => setCfg(c => { const t = [...c.ticks]; t[i] = v; return { ...c, ticks: t } })
  const toggleMk = sy => setCfg(c => ({ ...c, mk: SYMS.filter(s => (s === sy ? !c.mk.includes(s) : c.mk.includes(s))) })) // keeps the natural order

  const plan = useMemo(() => (cfg.mk.length ? buildPlan({ ...cfg, markets: cfg.mk }) : null), [cfg])
  const problem = !dv.acct ? 'Log in first (top right)' : !dv.ready ? 'Connecting to your account…' : !cfg.mk.length ? 'Select at least one market' : !(+cfg.stake >= 0.35) ? 'Stake must be at least 0.35' : ''

  const launch = pl => {
    const e = new DiffersEngine({ send: dv.send, feed, log: addLog, emit: () => setSnap(e.snapshot()), cur: () => dv.cur.current, names: NAME, allSyms: SYMS })
    eng.current = e; setLog([]); setPhase('run'); e.start(pl)
  }
  const start = () => {
    if (problem || !plan) return
    if (dv.live && !confirm('REAL account! Start this session?')) return
    lastPlan.current = plan; launch(plan)
  }
  const restart = () => { // same plan again, straight away
    if (!lastPlan.current || !dv.ready) return
    if (dv.live && !confirm('REAL account! Restart with the same settings?')) return
    launch(lastPlan.current)
  }
  const back = () => { eng.current = null; setSnap(null); setPhase('setup') } // Edit settings: your settings are still filled in

  const running = snap?.phase === 'running'
  const rows = snap?.rows || []
  const done = rows.filter(r => ['win', 'loss', 'skipped'].includes(r.status)).length
  const cur = snap && snap.phase === 'running' ? rows[Math.min(snap.idx, rows.length - 1)] : null

  return (
    <div onClick={() => dv.setMenu(false)}>
      <header className="top">
        <div className="brand">
          <img src="/logo.png" alt="" className="blogo" onError={e => { e.currentTarget.style.display = 'none' }} />
          <span className="by">By TradeXpertz</span>
        </div>
        <AccountBar d={dv} />
      </header>
      {tabs}

      <div className="dh">
        {phase === 'setup' && (
          <>
            <div className="dh2">
              <div className="col">
                <div className="card">
                  <h3>RUNS</h3>
                  <div className="runbtns">
                    {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <button key={n} className={'rb' + (cfg.runs === n ? ' on' : '')} onClick={() => upd('runs', n)}>{n}</button>)}
                  </div>
                  <p className="tnote muted">Each run places ONE Digit Differs contract on ONE market. The session ends after the last run.</p>

                  <h3>DURATION PER RUN (TICKS, 1–10)</h3>
                  <div className="tickgrid">
                    {Array.from({ length: cfg.runs }, (_, i) => (
                      <div key={i}><label>Run {i + 1}</label><input type="number" min="1" max="10" value={cfg.ticks[i]} onChange={e => setTick(i, e.target.value)} /></div>
                    ))}
                  </div>

                  <h3>MARKETS (ROTATE — ONE MARKET PER RUN)</h3>
                  <div className="mkgrid">
                    {SYMS.map(sy => <label key={sy} className="chk"><input type="checkbox" checked={cfg.mk.includes(sy)} onChange={() => toggleMk(sy)} /> {NAME[sy].replace(' Index', '')}</label>)}
                  </div>
                </div>
              </div>

              <div className="col">
                <div className="card">
                  <h3>STAKE &amp; LIMITS</h3>
                  <div className="g3">
                    <div><label>Stake per run ($)</label><input type="number" min="0.35" step="0.1" value={cfg.stake} onChange={e => upd('stake', e.target.value)} /></div>
                    <div><label title="Session ends when total profit reaches this (0 = off)">Take profit ($)</label><input type="number" min="0" value={cfg.tp} onChange={e => upd('tp', e.target.value)} /></div>
                    <div><label title="Session ends when total loss reaches this (0 = off)">Stop loss ($)</label><input type="number" min="0" value={cfg.sl} onChange={e => upd('sl', e.target.value)} /></div>
                  </div>

                  <h3>RECOVERY</h3>
                  <div className="seg">
                    <button className={!cfg.rec.on ? 'on' : ''} onClick={() => updRec('on', false)}>Off</button>
                    <button className={cfg.rec.on ? 'on' : ''} onClick={() => updRec('on', true)}>On</button>
                    <span className="muted segnote">{cfg.rec.on ? 'Loss → recovery: Over 2, then Under 7, then Over 2 … a different market each step. Recovery trades are not runs.' : 'After a loss the session carries on with the next run.'}</span>
                  </div>
                  {cfg.rec.on && (
                    <div className="g3" style={{ marginTop: 10 }}>
                      <div><label title="Recovery stake multiplier after each loss (step 1 Over 2, step 2 Under 7, step 3 Over 2 ...)">Recovery stake ×</label><input type="number" min="1" step="0.5" value={cfg.rec.mult} onChange={e => updRec('mult', e.target.value)} /></div>
                      <div><label title="Maximum recovery attempts (alternating Over 2 / Under 7, a different market each step)">Max steps</label><input type="number" min="1" value={cfg.rec.steps} onChange={e => updRec('steps', e.target.value)} /></div>
                      <div><label title="Session stops if the next Over 2 stake would be above this">Max rec. stake ($)</label><input type="number" min="1" value={cfg.rec.maxStake} onChange={e => updRec('maxStake', e.target.value)} /></div>
                      <div><label title="Digits in a row before the recovery trade is bought: 0-1-2 for Over 2 steps, 7-8-9 for Under 7 steps">Digits in a row</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            title={cfg.rec.needOn ? 'ON: waits for digit pattern before buying' : 'OFF: buys immediately without waiting for a digit pattern'}
                            onClick={() => updRec('needOn', !cfg.rec.needOn)}
                            style={{ padding: '4px 10px', borderRadius: 14, border: 0, fontWeight: 700, fontSize: 12, cursor: 'pointer', background: cfg.rec.needOn ? '#1fd15a' : '#555', color: '#fff', whiteSpace: 'nowrap' }}>
                            {cfg.rec.needOn ? 'ON' : 'OFF'}
                          </button>
                          <input type="number" min="1" max="5" value={cfg.rec.need} onChange={e => updRec('need', e.target.value)} disabled={!cfg.rec.needOn} style={{ opacity: cfg.rec.needOn ? 1 : 0.4 }} />
                        </div>
                      </div>
                      <div><label title="Minutes to watch each market before moving to the next-lowest 0-1-2 market">Watch / market (min)</label><input type="number" min="0.1" max="30" step="0.5" value={cfg.rec.watch} onChange={e => updRec('watch', e.target.value)} /></div>
                      <div><label title="Ticks used to find the market with the fewest 0-1-2 digits">Digit window</label><input type="number" min="100" value={cfg.rec.digN} onChange={e => updRec('digN', e.target.value)} /></div>
                    </div>
                  )}

                  <p className="tnote muted" style={{ marginTop: 16 }}>{cfg.runs} runs · stake ${(+cfg.stake || 0).toFixed(2)} · take profit {+cfg.tp ? '$' + cfg.tp : 'off'} · stop loss {+cfg.sl ? '$' + cfg.sl : 'off'} · recovery {cfg.rec.on ? 'ON' : 'OFF'}</p>
                  <button className="cta" style={{ marginTop: 4 }} disabled={!!problem} onClick={start}>▶ Start session</button>
                  {problem && <p className="tnote muted" style={{ textAlign: 'center', margin: '8px 0 0' }}>{problem}</p>}
                </div>
                {log.length > 0 && <div className="card"><div className="log">{log.map((l, i) => <div key={i}>{l}</div>)}</div></div>}
              </div>
            </div>

            <div className="card">
              <h3>PLAN <span className="muted" style={{ fontWeight: 400, letterSpacing: 0 }}>· the Differs digit is picked at purchase time: the LOWEST share in that market's last 100 ticks</span></h3>
              {plan ? (
                <div className="plan">
                  {plan.runs.map((r, i) => {
                    const dg = feed.lastDigits(r.sy, 100), pk = dg ? pickDigit(dg) : null
                    return (
                      <div key={i} className="pl">
                        <b>Run {i + 1}</b><span>{SHORT(r.sy)}</span><span className="mono">{r.ticks} ticks</span>
                        <span className="muted">{pk ? `digit ${pk.digit} (${Math.round(pk.share * 100)}%)` : 'loading ticks…'}</span>
                      </div>
                    )
                  })}
                </div>
              ) : <p className="tnote muted">Select at least one market.</p>}
            </div>
          </>
        )}

        {phase === 'run' && snap && (
          <div className="dh2">
            <div className="col">
              <div className="card">
                <div className="dh-top">
                  <span className={'chip2 ' + (snap.recOn ? 'cp' : 'cg')}>Recovery {snap.recOn ? 'ON' : 'OFF'}</span>
                  <span className={'chip2 ' + (running ? 'cok' : 'cg')}>{running ? '● Running' : snap.reason.startsWith('✅') || snap.reason.startsWith('🎯') ? '✓ Finished' : '■ Stopped'}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{dv.acct?.id} {dv.live ? '(REAL)' : '(demo)'}</span>
                  {running && <span style={{ marginLeft: 'auto' }}><button className="mini" onClick={() => { if (confirm('Stop the session? An open contract stays on Deriv.')) eng.current?.stop('■ Stopped by you') }}>Stop</button></span>}
                </div>
                <div className="dh-status"><b>{snap.status}</b></div>
                <div className="bar"><i style={{ width: `${snap.total ? (done / snap.total) * 100 : 0}%` }} /></div>
                <div className="dstats">
                  <div><span>Session P/L</span><b className={snap.pnl >= 0 ? 'g' : 'r'}>{money(snap.pnl)}</b></div>
                  <div><span>Runs</span><b>{done} / {snap.total}</b></div>
                  <div><span>Wins</span><b className="g">{snap.w}</b></div>
                  <div><span>Losses</span><b className="r">{snap.l}</b></div>
                </div>
                {snap.recOn && (Object.keys(snap.recDone).length > 0 || snap.recFail > 0) && (
                  <div className="tnote muted" style={{ marginTop: 6 }}>🛠 Recovered at {Object.entries(snap.recDone).map(([k, v]) => `step ${k}: ${v}`).join(' · ') || '—'}{snap.recFail > 0 ? ` · failed: ${snap.recFail}` : ''}</div>
                )}
                {!running && (
                  <div className="rsbtns">
                    <button className="btn-red" disabled={!dv.ready} onClick={restart}>Restart, same settings</button>
                    <button className="btn-out" onClick={back}>Edit settings</button>
                  </div>
                )}
              </div>

              <div className="card">
                <div className="druns">
                  {rows.map((r, i) => (
                    <div key={i}>
                      <div className={'dr ' + r.status}>
                        <span className="dot" />
                        <b>Run {i + 1}</b>
                        <span>{SHORT(r.sy)}</span>
                        <span className="muted">{r.digit != null ? `Differs ${r.digit} (${Math.round(r.share * 100)}%)` : '—'}</span>
                        <span className="mono">{r.ticks} ticks</span>
                        <span className="res">
                          {r.status === 'win' && <b className="g">WIN {money(r.profit)}</b>}
                          {r.status === 'loss' && <b className="r">LOSS {money(r.profit)}</b>}
                          {r.status === 'trading' && <b className="amber">TRADING…</b>}
                          {r.status === 'active' && <b className="amber">SEEKING</b>}
                          {r.status === 'skipped' && <span className="muted">skipped</span>}
                          {r.status === 'stopped' && <span className="muted">stopped</span>}
                          {r.status === 'waiting' && <span className="muted">waiting</span>}
                        </span>
                      </div>
                      {r.recs.map((x, k) => (
                        <div key={k} className="dr sub"><span /><span className="muted">↳ recovery {x.step}</span><span>{x.label}</span><span className="muted">{x.name.replace(' Index', '')}</span><span className="mono">stake {x.stake.toFixed(2)}</span><span className="res"><b className={x.profit > 0 ? 'g' : 'r'}>{x.profit > 0 ? 'WIN' : 'LOSS'} {money(x.profit)}</b></span></div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="col">
              {snap.rec && (
                <div className="card">
                  <div className="qbadge r" style={{ marginTop: 0 }}>
                    🛠 Recovery step {snap.rec.step} · debt {snap.rec.debt.toFixed(2)} · {snap.rec.label} on {snap.rec.name} · stake {snap.rec.stake.toFixed(2)}
                    {snap.rec.stage === 'wait' && <> · 👀 watching market {snap.rec.pos}/{snap.rec.total} · {snap.rec.kind === 'under' ? 'high digits (7-8-9)' : 'low digits (0-1-2)'} in a row: {snap.rec.seq}/{snap.rec.need}</>}
                    {snap.rec.stage === 'buy' && <> · ⚡ buying</>}
                    {snap.rec.tape?.length > 0 && <div className="tape">Last digits: {snap.rec.tape.map((d, i) => <b key={i} className={(snap.rec.kind === 'under' ? d >= 7 : d <= 2) ? 'low' : ''}>{d}</b>)}</div>}
                  </div>
                </div>
              )}

              {cur && (() => {
                const dg = feed.lastDigits(cur.sy, 100)
                if (!dg) return null
                const counts = new Array(10).fill(0); dg.forEach(d => counts[d]++)
                const min = Math.min(...counts)
                return (
                  <div className="card">
                    <div className="tnote muted" style={{ marginBottom: 8 }}>Digits in the last 100 ticks · {SHORT(cur.sy)} (the lowest share is the Differs digit)</div>
                    <div className="dbars">
                      {counts.map((c, d) => <div key={d} className={'dbar' + (c === min ? ' min' : '')}><i style={{ height: `${Math.min(100, c * 4)}%` }} /><b>{d}</b><span>{c}%</span></div>)}
                    </div>
                  </div>
                )
              })()}

              <div className="card"><div className="log">{log.map((l, i) => <div key={i}>{l}</div>)}</div></div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
