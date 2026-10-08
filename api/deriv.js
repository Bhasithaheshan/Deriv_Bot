// Vercel serverless proxy: OAuth token exchange + REST calls (keeps secrets/CORS off the browser)
const AUTH = 'https://auth.deriv.com/oauth2/token'
const API = 'https://api.derivws.com'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { action, code, verifier, redirect_uri, token, accountId } = req.body || {}
  const clientId = process.env.VITE_DERIV_APP_ID
  try {
    let r
    if (action === 'token') {
      const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri, code_verifier: verifier })
      if (process.env.DERIV_CLIENT_SECRET) body.set('client_secret', process.env.DERIV_CLIENT_SECRET)
      r = await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    } else if (action === 'accounts') {
      r = await fetch(`${API}/trading/v1/options/accounts`, { headers: { Authorization: `Bearer ${token}` } })
    } else if (action === 'otp') {
      r = await fetch(`${API}/trading/v1/options/accounts/${encodeURIComponent(accountId)}/otp`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } })
    } else return res.status(400).json({ error: 'bad action' })
    const text = await r.text()
    res.status(r.status).setHeader('Content-Type', 'application/json').send(text)
  } catch (e) { res.status(500).json({ error: String(e) }) }
}
