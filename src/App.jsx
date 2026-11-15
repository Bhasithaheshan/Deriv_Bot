import { useEffect, useState } from 'react'
import Recovery from './Recovery.jsx'
import Differs from './Differs.jsx'
import Tester from './Tester.jsx'
import { store } from './deriv.jsx'

const TABS = [['recovery', '🎯 Accumulator Hunter'], ['differs', '🎲 Differs Hunter'], ['tester', '🧪 Tester']]
const pageFromUrl = () => { // old links / saved pages ('home', '#recovery') now open Accumulator Hunter
  const h = window.location.hash.replace('#', '')
  if (h === 'tester' || h === 'differs') return h
  if (h) return 'recovery'
  try { const v = localStorage.getItem('page'); return v === 'tester' || v === 'differs' ? v : 'recovery' } catch { return 'recovery' }
}

// Read cached demo account balance from localStorage (saved by Recovery/Differs login)
function getDemoBalance() {
  try {
    const accts = JSON.parse(store.get('accts') || 'null')
    if (!accts?.length) return null
    const demo = accts.find(a => a.demo)
    if (demo?.bal != null) return +demo.bal
  } catch { /* ignore */ }
  return null
}

export default function App() {
  const [page, setPage] = useState(pageFromUrl)
  const [demoBalance, setDemoBalance] = useState(getDemoBalance)

  // Re-read balance when switching to Tester tab (in case user just logged in)
  useEffect(() => {
    if (page === 'tester') setDemoBalance(getDemoBalance())
  }, [page])

  const go = p => {
    if (p === page) return
    if (window.__botRunning && !confirm('The bot is running. Switching tabs stops it (an open trade stays on Deriv). Continue?')) return
    setPage(p)
    try { localStorage.setItem('page', p) } catch { /* ignore */ }
    window.history.replaceState(null, '', p === 'recovery' ? window.location.pathname : '#' + p)
  }
  // the tab bar is rendered by each page, right UNDER its header (logo / login)
  const tabs = (
    <nav className="tabs">
      {TABS.map(([k, label]) => <button key={k} className={'tab' + (page === k ? ' on' : '')} onClick={() => go(k)}>{label}</button>)}
    </nav>
  )
  if (page === 'tester') return <Tester key="tester" tabs={tabs} demoBalance={demoBalance} />
  if (page === 'differs') return <Differs key="differs" tabs={tabs} />
  return <Recovery key="recovery" tabs={tabs} />
}
