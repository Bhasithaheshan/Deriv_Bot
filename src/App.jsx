import { useState } from 'react'
import Home from './Home.jsx'
import Recovery from './Recovery.jsx'

const TABS = [['home', '🏠 Accumulator Bot'], ['recovery', '🔄 Rotate + Recovery']]
const pageFromUrl = () => {
  const h = window.location.hash.replace('#', '')
  if (h === 'home' || h === 'recovery') return h
  try { return localStorage.getItem('page') === 'recovery' ? 'recovery' : 'home' } catch { return 'home' }
}

export default function App() {
  const [page, setPage] = useState(pageFromUrl)
  const go = p => {
    if (p === page) return
    if (window.__botRunning && !confirm('The bot is running. Switching tabs stops it (an open trade stays on Deriv). Continue?')) return
    setPage(p)
    try { localStorage.setItem('page', p) } catch { /* ignore */ }
    window.history.replaceState(null, '', p === 'recovery' ? '#recovery' : window.location.pathname)
  }
  // the tab bar is rendered by each page, right UNDER its header (logo / login)
  const tabs = (
    <nav className="tabs">
      {TABS.map(([k, label]) => <button key={k} className={'tab' + (page === k ? ' on' : '')} onClick={() => go(k)}>{label}</button>)}
    </nav>
  )
  return page === 'recovery' ? <Recovery key="recovery" tabs={tabs} /> : <Home key="home" tabs={tabs} />
}
