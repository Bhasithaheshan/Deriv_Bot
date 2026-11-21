import { useEffect, useRef, useState } from 'react'
import Recovery from './Recovery.jsx'
import Differs from './Differs.jsx'
import Tester from './Tester.jsx'
import { store } from './deriv.jsx'

const TABS = [['recovery', '🎯 Accumulator Hunter'], ['differs', '🎲 Differs Hunter'], ['tester', '🧪 Tester']]
const TAB_KEYS = TABS.map(t => t[0])

const pageFromUrl = () => {
  const h = window.location.hash.replace('#', '')
  if (h === 'tester' || h === 'differs') return h
  if (h) return 'recovery'
  try { const v = localStorage.getItem('page'); return v === 'tester' || v === 'differs' ? v : 'recovery' } catch { return 'recovery' }
}

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
  const touchStart = useRef(null)
  const tabsRef = useRef(null)

  useEffect(() => {
    if (page === 'tester') setDemoBalance(getDemoBalance())
  }, [page])

  // Scroll active tab into view whenever page changes
  useEffect(() => {
    if (!tabsRef.current) return
    const activeBtn = tabsRef.current.querySelector('.tab.on')
    if (activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' })
  }, [page])

  const go = p => {
    if (p === page) return
    if (window.__botRunning && !confirm('The bot is running. Switching tabs stops it (an open trade stays on Deriv). Continue?')) return
    setPage(p)
    try { localStorage.setItem('page', p) } catch { /* ignore */ }
    window.history.replaceState(null, '', p === 'recovery' ? window.location.pathname : '#' + p)
  }

  // Swipe left/right on the page content to switch tabs
  const onTouchStart = e => { touchStart.current = e.touches[0].clientX }
  const onTouchEnd = e => {
    if (touchStart.current == null) return
    const dx = e.changedTouches[0].clientX - touchStart.current
    touchStart.current = null
    if (Math.abs(dx) < 60) return // too short — ignore
    const idx = TAB_KEYS.indexOf(page)
    if (dx < 0 && idx < TAB_KEYS.length - 1) go(TAB_KEYS[idx + 1]) // swipe left → next tab
    if (dx > 0 && idx > 0) go(TAB_KEYS[idx - 1])                   // swipe right → prev tab
  }

  const tabs = (
    <nav className="tabs" ref={tabsRef}>
      {TABS.map(([k, label]) => <button key={k} className={'tab' + (page === k ? ' on' : '')} onClick={() => go(k)}>{label}</button>)}
    </nav>
  )

  const swipeProps = { onTouchStart, onTouchEnd }

  if (page === 'tester') return <Tester key="tester" tabs={tabs} demoBalance={demoBalance} swipeProps={swipeProps} />
  if (page === 'differs') return <Differs key="differs" tabs={tabs} swipeProps={swipeProps} />
  return <Recovery key="recovery" tabs={tabs} swipeProps={swipeProps} />
}
