import { freshState, instruments, saveLimits } from './model'
import type { TraderState } from './model'
export const STORAGE_KEY = 'stock-auto-trader:v0.1'
export function parseSavedState(raw: string | null): TraderState {
  if (!raw) return freshState()
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return freshState()
    const s = value as TraderState, symbols = new Set(instruments.map(i => i.symbol))
    const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
    if (s.version !== 1 || !finite(s.cash) || s.cash < 0 || !finite(s.realized) || typeof s.halted !== 'boolean') return freshState()
    if (!Array.isArray(s.positions) || !s.positions.every(p => p && symbols.has(p.symbol) && Number.isInteger(p.quantity) && p.quantity > 0 && finite(p.average) && p.average > 0) || new Set(s.positions.map(p => p.symbol)).size !== s.positions.length) return freshState()
    const known = freshState().strategies
    if (!Array.isArray(s.strategies) || s.strategies.length !== known.length || !known.every(k => s.strategies.some(x => x.id === k.id && typeof x.running === 'boolean'))) return freshState()
    if (!Array.isArray(s.orders) || s.orders.length > 10000 || !s.orders.every(o => o && typeof o.id === 'string' && symbols.has(o.symbol) && known.some(k => k.id === o.strategyId) && ['buy', 'sell'].includes(o.side) && ['pending', 'filled', 'cancelled'].includes(o.status) && Number.isInteger(o.quantity) && o.quantity > 0 && finite(o.price) && o.price > 0 && typeof o.time === 'string') || new Set(s.orders.map(o => o.id)).size !== s.orders.length) return freshState()
    if (!Array.isArray(s.events) || !s.events.every(e => e && typeof e.id === 'string' && typeof e.message === 'string' && typeof e.time === 'string' && ['info', 'warning'].includes(e.level))) return freshState()
    saveLimits(s, s.limits)
    return { ...s, strategies: known.map(k => ({ ...k, running: !s.halted && !!s.strategies.find(x => x.id === k.id)?.running })), orders: s.halted ? s.orders.map(o => o.status === 'pending' ? { ...o, status: 'cancelled' } : o) : s.orders, events: s.events.slice(0, 40) }
  } catch { return freshState() }
}
export function readSavedState() { try { return parseSavedState(localStorage.getItem(STORAGE_KEY)) } catch { return freshState() } }
