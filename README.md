# Accumulator Bot (Deriv new API)
1. https://developers.deriv.com -> Register application. Redirect URL = https://YOUR-SITE.vercel.app/  (trailing slash, exact match)
2. Vercel -> Settings -> Environment Variables: VITE_DERIV_APP_ID = <your App ID>, then Redeploy
3. Local: `vercel dev` (so /api works) with a .env containing VITE_DERIV_APP_ID
Demo account is selected first after login. Never commit tokens.
