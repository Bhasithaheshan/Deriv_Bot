import { useEffect, useRef, useState } from 'react'

// Shared Deriv login + trading connection for pages that only need to trade (used by Differs Hunter).
const APP_ID = import.meta.env.VITE_DERIV_APP_ID
const redirectUri = () => window.location.origin + '/'
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const store = {
  get: k => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
  del: k => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}
const saveTok = j => {
  store.set('tok', j.access_token)
  if (j.refresh_token) store.set('rtok', j.refresh_token)
  if (j.expires_in) store.set('tokExp', String(Date.now() + j.expires_in * 1000)); else store.del('tokExp')
}
const api = async body => {
  const r = await fetch('/api/deriv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(r.status + ' ' + JSON.stringify(j).slice(0, 250))
  return j
}
let refreshing = null
const refreshToken = () => {
  if (!refreshing) refreshing = (async () => {
    const rt = store.get('rtok'); if (!rt) return null
    try { const j = await api({ action: 'refresh', refresh_token: rt }); if (!j.access_token) return null; saveTok(j); return j.access_token } catch { return null }
  })().finally(() => { refreshing = null })
  return refreshing
}
const norm = a => ({ id: a.account_id || a.id || a.loginid, demo: /demo|virtual/i.test(JSON.stringify(a)), bal: a.balance, cur: a.currency })

export function useDeriv(addLog) {
  const [acct, setAcct] = useState(null)
  const [accts, setAccts] = useState([])
  const [balance, setBalance] = useState(null)
  const [fail, setFail] = useState(false)
  const [ready, setReady] = useState(false)
  const [menu, setMenu] = useState(false)
  const ws = useRef(null), msgRef = useRef(null), closeRef = useRef(null), cur = useRef('USD')
  const send = o => { if (ws.current?.readyState === 1) { ws.current.send(JSON.stringify(o)); return true } return false }

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
  const connect = url => {
    const old = ws.current; ws.current = null
    if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; old.close() }
    setReady(false)
    const s = new WebSocket(url); ws.current = s
    s.onopen = () => { addLog('Connected (trading)'); setFail(false); setReady(true); send({ balance: 1, subscribe: 1 }) }
    s.onmessage = e => {
      let m; try { m = JSON.parse(e.data) } catch { return }
      if (m.msg_type === 'balance' && m.balance) { setBalance(`${m.balance.balance} ${m.balance.currency}`); cur.current = m.balance.currency; return }
      msgRef.current?.(m)
    }
    s.onclose = () => { if (ws.current !== s) return; setReady(false); setFail(true); addLog('⚠️ Trading connection lost — press Retry'); closeRef.current?.() }
    s.onerror = () => { if (ws.current === s) addLog('Socket error') }
  }
  const selectAccount = async (a, tok, retried = false) => {
    try {
      setAcct(a); setBalance(null); store.set('acctId', a.id)
      const j = await withRetry(() => api({ action: 'otp', token: tok, accountId: a.id }), 'account')
      const url = j.data?.url
      if (!url) throw new Error('OTP url missing: ' + JSON.stringify(j).slice(0, 200))
      cur.current = a.cur || 'USD'
      connect(url)
    } catch (e) {
      const msg = String(e.message || e)
      if (/^40[13]/.test(msg) && !retried) { const nt = await refreshToken(); if (nt) return selectAccount(a, nt, true) }
      addLog('❌ ' + msg); setFail(true)
    }
  }
  const loadAccounts = async (tok0, refreshed = false) => {
    let tok = tok0
    const exp = +(store.get('tokExp') || 0)
    if (exp && Date.now() > exp - 60000) { const nt = await refreshToken(); if (nt) tok = nt }
    let cached = null
    try { cached = JSON.parse(store.get('accts') || 'null') } catch { /* ignore */ }
    const want = store.get('acctId')
    if (cached?.length) { setAccts(cached); selectAccount(cached.find(a => a.id === want) || cached.find(a => a.demo) || cached[0], tok) }
    try {
      const j = await withRetry(() => api({ action: 'accounts', token: tok }), 'accounts')
      const list = (Array.isArray(j.data) ? j.data : j.data?.accounts || j.accounts || []).map(norm).filter(a => a.id)
      if (!list.length) return addLog('❌ No accounts: ' + JSON.stringify(j).slice(0, 250))
      setAccts(list); store.set('accts', JSON.stringify(list))
      if (!cached?.length) selectAccount(list.find(a => a.demo) || list[0], tok) // demo first = safer
    } catch (e) {
      const msg = String(e.message || e)
      if (cached?.length && !/^40[13]/.test(msg)) return
      if (/^40[13]/.test(msg)) {
        if (!refreshed) { const nt = await refreshToken(); if (nt) return loadAccounts(nt, true) }
        ;['tok', 'rtok', 'tokExp', 'accts'].forEach(k => store.del(k)); addLog('❌ Login expired — please log in again')
      } else addLog('❌ Deriv unavailable (' + msg.slice(0, 90) + ') — press Retry')
      setFail(true)
    }
  }
  const login = async signup => {
    if (!APP_ID) return addLog('❌ VITE_DERIV_APP_ID is not set (Vercel env)')
    const v = b64(crypto.getRandomValues(new Uint8Array(32)))
    const state = b64(crypto.getRandomValues(new Uint8Array(16)))
    const ch = b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
    sessionStorage.setItem('pkce', JSON.stringify({ v, state }))
    const q = new URLSearchParams({ response_type: 'code', client_id: APP_ID, redirect_uri: redirectUri(), scope: 'trade', state, code_challenge: ch, code_challenge_method: 'S256' })
    if (signup) q.set('prompt', 'registration')
    window.location.href = 'https://auth.deriv.com/oauth2/auth?' + q
  }
  const logout = () => {
    ;['tok', 'rtok', 'tokExp', 'accts', 'acctId'].forEach(k => store.del(k))
    const s = ws.current; ws.current = null; if (s) { s.onclose = null; s.close() }
    setAccts([]); setAcct(null); setBalance(null); setReady(false)
  }
  const retryNow = () => { setFail(false); const t = store.get('tok'); if (!t) return; accts.length ? selectAccount(acct || accts[0], t) : loadAccounts(t) }

  useEffect(() => {
    const p = new URLSearchParams(window.location.search), code = p.get('code')
    if (p.get('error')) addLog('❌ Login: ' + (p.get('error_description') || p.get('error')))
    if (code) {
      const saved = JSON.parse(sessionStorage.getItem('pkce') || '{}')
      window.history.replaceState({}, '', window.location.pathname)
      if (p.get('state') !== saved.state) return addLog('❌ State mismatch, log in again')
      withRetry(() => api({ action: 'token', code, verifier: saved.v, redirect_uri: redirectUri() }), 'login')
        .then(j => { saveTok(j); loadAccounts(j.access_token) })
        .catch(e => { addLog('❌ Login failed: ' + String(e.message).slice(0, 120) + ' — please log in again'); setFail(true) })
    } else { const t = store.get('tok'); if (t) loadAccounts(t) }
    const ping = setInterval(() => send({ ping: 1 }), 30000)
    return () => { clearInterval(ping); const s = ws.current; ws.current = null; if (s) { s.onclose = null; s.close() } }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    acct, accts, balance, fail, ready, menu, setMenu, cur, send, live: !!acct && !acct.demo,
    setOnMessage: f => { msgRef.current = f }, setOnClose: f => { closeRef.current = f },
    login, logout, selectAccount, retryNow,
  }
}

// right-hand part of the header: Log in / Sign up, or the account pill + Log out
export function AccountBar({ d }) {
  const tok = store.get('tok')
  const [editingCap, setEditingCap] = useState(false)
  const [capInput, setCapInput] = useState('')

  // Load saved custom capital from localStorage
  const savedCap = store.get('customCapital')
  const customCap = savedCap ? parseFloat(savedCap) : null

  // Current live balance as a number
  const liveBal = d.balance ? parseFloat(d.balance) : null

  // P&L relative to custom capital
  const pnl = (customCap != null && liveBal != null) ? liveBal - customCap : null

  const openEdit = e => {
    e.stopPropagation()
    setCapInput(customCap != null ? String(customCap) : (liveBal != null ? String(liveBal) : '10000'))
    setEditingCap(true)
  }
  const saveCap = () => {
    const v = parseFloat(capInput)
    if (!isNaN(v) && v > 0) store.set('customCapital', String(v))
    setEditingCap(false)
  }
  const clearCap = e => { e.stopPropagation(); store.del('customCapital'); setEditingCap(false) }

  return (
    <div className="topright" onClick={e => e.stopPropagation()}>
      {!tok ? (
        <>
          <button className="pill" onClick={() => d.login(false)}>Log in</button>
          <button className="pill red" onClick={() => d.login(true)}>Sign up</button>
        </>
      ) : (
        <>
          {d.acct ? (
            <div className="acctwrap">
              <button className="acct" onClick={() => d.setMenu(m => !m)}>
                <span className="acctin">
                  <span className={'alab ' + (d.live ? 'real' : 'demo')}>{d.live ? 'Real account' : 'Demo account'}</span>
                  <b>{d.balance || '...'}</b>
                  {/* Capital & P&L row — only for demo */}
                  {!d.live && customCap != null && pnl != null && (
                    <span style={{ fontSize: 11, color: pnl >= 0 ? '#2ecc71' : '#ff5555', marginTop: 1 }}>
                      Cap: ${customCap.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} · P&L: {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </span>
                  )}
                </span>
                <span className="chev">⌄</span>
              </button>
              {d.menu && (
                <div className="menu">
                  {d.accts.map(a => (
                    <button key={a.id} className={'mi' + (a.id === d.acct?.id ? ' sel' : '')} onClick={() => { d.setMenu(false); d.selectAccount(a, tok) }}>
                      <span className={a.demo ? 'demo' : 'real'}>{a.demo ? 'Demo' : 'Real'}</span>
                      <span>{a.id}</span>
                      <b>{a.id === d.acct?.id ? d.balance : `${a.bal ?? ''} ${a.cur ?? ''}`}</b>
                    </button>
                  ))}
                  {/* Custom capital editor — demo only */}
                  {!d.live && (
                    <div style={{ borderTop: '1px solid #2a303a', margin: '6px 0 0', padding: '10px 12px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ fontSize: 12, color: '#8b95a5', marginBottom: 6 }}>💰 Starting Capital (USD)</div>
                      {editingCap ? (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                          <input
                            autoFocus
                            type="number" min="1" step="0.01"
                            value={capInput}
                            onChange={e => setCapInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveCap(); if (e.key === 'Escape') setEditingCap(false) }}
                            style={{ flex: 1, padding: '5px 8px', fontSize: 14, fontWeight: 700, background: '#0e1116', color: '#fff', border: '1px solid #2a9df4', borderRadius: 6 }}
                          />
                          <button onClick={saveCap} style={{ padding: '5px 10px', borderRadius: 6, border: 0, background: '#2a9df4', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>✓</button>
                          <button onClick={clearCap} style={{ padding: '5px 8px', borderRadius: 6, border: 0, background: '#333', color: '#aaa', cursor: 'pointer' }}>✕</button>
                        </div>
                      ) : (
                        <button onClick={openEdit} style={{ width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6, border: '1px dashed #2a303a', background: 'transparent', color: customCap != null ? '#fff' : '#5d6878', cursor: 'pointer', fontSize: 13 }}>
                          {customCap != null ? `$${customCap.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} ✏️` : '+ Set starting capital'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : <span className="conn">Connecting…</span>}
          {d.fail && <button className="pill" onClick={d.retryNow}>⟳ Retry</button>}
          <button className="pill" onClick={d.logout}>Log out</button>
        </>
      )}
    </div>
  )
}
