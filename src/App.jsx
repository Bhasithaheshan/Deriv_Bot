import { useState } from 'react'
import Recovery from './Recovery.jsx'
import Tester from './Tester.jsx'

const TABS = [['recovery', '🎯 Accumulator Hunter'], ['tester', '🧪 Tester']]
const pageFromUrl = () => { // old links / saved pages ('home', '#recovery') now open Accumulator Hunter
  const h = window.location.hash.replace('#', '')
  if (h === 'tester') return 'tester'
  if (h) return 'recovery'
  try { return localStorage.getItem('page') === 'tester' ? 'tester' : 'recovery' } catch { return 'recovery' }
}

export default function App() {
  const [page, setPage] = useState(pageFromUrl)
  const go = p => {
    if (p === page) return
    if (window.__botRunning && !confirm('The bot is running. Switching tabs stops it (an open trade stays on Deriv). Continue?')) return
    setPage(p)
    try { localStorage.setItem('page', p) } catch { /* ignore */ }
    window.history.replaceState(null, '', p === 'tester' ? '#tester' : window.location.pathname)
  }
  // the tab bar is rendered by each page, right UNDER its header (logo / login)
  const tabs = (
    <nav className="tabs">
      {TABS.map(([k, label]) => <button key={k} className={'tab' + (page === k ? ' on' : '')} onClick={() => go(k)}>{label}</button>)}
    </nav>
  )
  if (page === 'tester') return <Tester key="tester" tabs={tabs} />
  return <Recovery key="recovery" tabs={tabs} />
}
