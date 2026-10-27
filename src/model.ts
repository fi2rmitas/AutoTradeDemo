export type Market = 'KR' | 'US'
export type Currency = 'KRW' | 'USD'
export interface Instrument { symbol: string; name: string; market: Market; currency: Currency; price: number; change: number; color: string }
export interface Position { symbol: string; quantity: number; average: number }
export interface Strategy { id: string; name: string; description: string; symbol: string; running: boolean; returnPct: number; winRate: number; trades: number; color: string }
export interface Order { id: string; symbol: string; strategyId: string; side: 'buy' | 'sell'; quantity: number; price: number; status: 'pending' | 'filled' | 'cancelled'; time: string }
export interface RiskLimits { dailyLoss: number; position: number; order: number }
export interface Event { id: string; time: string; message: string; level: 'info' | 'warning' }
export interface TraderState { version: 1; cash: number; realized: number; halted: boolean; positions: Position[]; strategies: Strategy[]; orders: Order[]; limits: RiskLimits; events: Event[] }
export const markets = {
  KR: { label: '국내 주식', currency: 'KRW', timezone: 'Asia/Seoul', enabled: true },
  US: { label: '미국 주식', currency: 'USD', timezone: 'America/New_York', enabled: false },
} as const
export const instruments: Instrument[] = [
  { symbol: '005930', name: '삼성전자', market: 'KR', currency: 'KRW', price: 72400, change: 1.26, color: '#3265c8' },
  { symbol: '000660', name: 'SK하이닉스', market: 'KR', currency: 'KRW', price: 183500, change: 2.23, color: '#da6750' },
  { symbol: '035420', name: 'NAVER', market: 'KR', currency: 'KRW', price: 191500, change: -0.78, color: '#22a56f' },
  { symbol: '005380', name: '현대차', market: 'KR', currency: 'KRW', price: 241000, change: 0.63, color: '#6656ae' },
  { symbol: '069500', name: 'KODEX 200', market: 'KR', currency: 'KRW', price: 35650, change: 0.85, color: '#d3a143' },
]
export const instrument = (symbol: string) => { const value = instruments.find(i => i.symbol === symbol); if (!value) throw new Error('지원하지 않는 가상 종목입니다.'); return value }
export const INITIAL_CAPITAL = 30000000
export const DAY_BASELINE = 33228000
export const initialState: TraderState = {
  version: 1, cash: 8540000, realized: 2350000, halted: false,
  positions: [ { symbol: '005930', quantity: 100, average: 68000 }, { symbol: '000660', quantity: 30, average: 171000 }, { symbol: '035420', quantity: 20, average: 195000 }, { symbol: '005380', quantity: 20, average: 229000 }, { symbol: '069500', quantity: 100, average: 34000 } ],
  strategies: [
    { id: 'momentum', name: '듀얼 모멘텀', description: '추세를 따라가는 상대·절대 모멘텀', symbol: '005930', running: true, returnPct: 14.82, winRate: 68.4, trades: 38, color: '#12a98e' },
    { id: 'reversion', name: '평균 회귀', description: '과매도 구간의 가격 정상화 포착', symbol: '000660', running: true, returnPct: 8.36, winRate: 72.1, trades: 43, color: '#627bdf' },
    { id: 'breakout', name: '변동성 돌파', description: '일중 변동폭을 활용한 돌파 전략', symbol: '035420', running: false, returnPct: -1.24, winRate: 45.0, trades: 20, color: '#d5a44b' },
  ],
  orders: [
    { id: 'SIM-1028', symbol: '005930', strategyId: 'momentum', side: 'buy', quantity: 5, price: 72400, status: 'pending', time: '14:32:08' },
    { id: 'SIM-1027', symbol: '000660', strategyId: 'reversion', side: 'buy', quantity: 2, price: 183500, status: 'filled', time: '14:28:42' },
    { id: 'SIM-1026', symbol: '035420', strategyId: 'breakout', side: 'sell', quantity: 3, price: 191500, status: 'filled', time: '14:15:16' },
  ],
  limits: { dailyLoss: 3, position: 30, order: 3000000 },
  events: [ { id: 'seed-1', time: '14:32:08', message: '삼성전자 5주 가상 매수 주문 대기', level: 'info' }, { id: 'seed-2', time: '14:00:00', message: '가상 데이터 시나리오 로드 완료', level: 'info' } ],
}
export const freshState = (): TraderState => structuredClone(initialState)
export const equity = (s: TraderState) => s.cash + s.positions.reduce((n, p) => n + p.quantity * instrument(p.symbol).price, 0)
export const reservedCash = (s: TraderState) => s.orders.filter(o => o.status === 'pending' && o.side === 'buy').reduce((n, o) => n + o.quantity * o.price, 0)
const clock = () => new Date().toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
const uid = () => globalThis.crypto.randomUUID()
export const event = (s: TraderState, message: string, level: Event['level'] = 'info'): TraderState => ({ ...s, events: [{ id: uid(), time: clock(), message, level }, ...s.events].slice(0, 40) })
export function toggleStrategy(s: TraderState, id: string): TraderState {
  if (s.halted) throw new Error('긴급 중지를 해제한 뒤 전략을 시작하세요.')
  const strategy = s.strategies.find(x => x.id === id)
  if (!strategy) throw new Error('전략을 찾을 수 없습니다.')
  return event({ ...s, strategies: s.strategies.map(x => x.id === id ? { ...x, running: !x.running } : x) }, `${strategy.name} ${strategy.running ? '일시정지' : '시작'}`)
}
export function validateOrder(s: TraderState, symbol: string, side: Order['side'], quantity: number) {
  if (s.halted) throw new Error('긴급 중지 상태입니다. 신규 주문이 차단되었습니다.')
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error('주문 수량은 1주 이상의 정수여야 합니다.')
  const value = quantity * instrument(symbol).price
  if (value > s.limits.order) throw new Error('1회 주문 금액 한도를 초과했습니다.')
  if ((equity(s) / DAY_BASELINE - 1) * 100 <= -s.limits.dailyLoss) throw new Error('일일 손실 한도에 도달했습니다.')
  const held = s.positions.find(p => p.symbol === symbol)?.quantity ?? 0
  const pending = s.orders.filter(o => o.status === 'pending' && o.symbol === symbol && o.side === side).reduce((n, o) => n + o.quantity, 0)
  if (side === 'buy') {
    if (s.cash - reservedCash(s) < value) throw new Error('가용 현금이 부족합니다. 대기 주문 예약 금액을 확인하세요.')
    if ((held + pending + quantity) * instrument(symbol).price / equity(s) * 100 > s.limits.position) throw new Error('종목별 최대 투자 비중을 초과했습니다.')
  } else if (held - pending < quantity) throw new Error('매도 가능한 보유 수량이 부족합니다.')
}
export function placeOrder(s: TraderState, strategyId: string, side: Order['side'] = 'buy', quantity = 3): TraderState {
  const strategy = s.strategies.find(x => x.id === strategyId)
  if (!strategy?.running) throw new Error('실행 중인 전략에서만 가상 주문을 생성할 수 있습니다.')
  validateOrder(s, strategy.symbol, side, quantity)
  const o: Order = { id: `SIM-${uid().slice(0, 8)}`, symbol: strategy.symbol, strategyId, side, quantity, price: instrument(strategy.symbol).price, status: 'pending', time: clock() }
  return event({ ...s, orders: [o, ...s.orders] }, `${instrument(o.symbol).name} ${quantity}주 가상 ${side === 'buy' ? '매수' : '매도'} 주문 생성`)
}
export function fillOrder(s: TraderState, id: string): TraderState {
  if (s.halted) throw new Error('긴급 중지 상태에서는 체결할 수 없습니다.')
  const o = s.orders.find(x => x.id === id)
  if (!o || o.status !== 'pending') throw new Error('대기 중인 주문만 체결할 수 있습니다.')
  validateOrder({ ...s, orders: s.orders.filter(x => x.id !== id) }, o.symbol, o.side, o.quantity)
  const p = s.positions.find(x => x.symbol === o.symbol)
  const oldQuantity = p?.quantity ?? 0
  const quantity = oldQuantity + (o.side === 'buy' ? o.quantity : -o.quantity)
  const average = o.side === 'buy' ? ((p?.average ?? 0) * oldQuantity + o.price * o.quantity) / quantity : (p?.average ?? 0)
  const positions = s.positions.filter(x => x.symbol !== o.symbol)
  if (quantity > 0) positions.push({ symbol: o.symbol, quantity, average })
  return event({ ...s, positions, cash: s.cash + o.price * o.quantity * (o.side === 'buy' ? -1 : 1), realized: s.realized + (o.side === 'sell' ? (o.price - (p?.average ?? 0)) * o.quantity : 0), orders: s.orders.map(x => x.id === id ? { ...x, status: 'filled' } : x) }, `${instrument(o.symbol).name} ${o.quantity}주 가상 체결 완료`)
}
export const cancelOrder = (s: TraderState, id: string) => event({ ...s, orders: s.orders.map(o => o.id === id && o.status === 'pending' ? { ...o, status: 'cancelled' } : o) }, '대기 중인 가상 주문 취소')
export const halt = (s: TraderState) => event({ ...s, halted: true, strategies: s.strategies.map(x => ({ ...x, running: false })), orders: s.orders.map(o => o.status === 'pending' ? { ...o, status: 'cancelled' } : o) }, '긴급 중지 · 모든 전략 정지 / 미체결 가상 주문 취소', 'warning')
export const resume = (s: TraderState) => event({ ...s, halted: false }, '긴급 중지 해제 · 전략은 개별 시작 필요')
export function saveLimits(s: TraderState, limits: RiskLimits) {
  if (!Number.isFinite(limits.dailyLoss) || limits.dailyLoss < 0.1 || limits.dailyLoss > 20 || !Number.isFinite(limits.position) || limits.position < 1 || limits.position > 100 || !Number.isFinite(limits.order) || limits.order < 10000 || limits.order > INITIAL_CAPITAL) throw new Error('손실 한도 0.1~20%, 종목 비중 1~100%, 주문 금액 1만~3천만원 범위를 확인하세요.')
  return event({ ...s, limits: { ...limits } }, '위험관리 한도 저장 완료 · 이후 주문·체결에 적용')
}
export interface BacktestConfig { strategy: string; start: string; end: string; capital: number; fee: number; slippage: number }
export interface BacktestResult { points: number[]; benchmark: number[]; dates: string[]; totalReturn: number; maxDrawdown: number; trades: number; winRate: number; finalEquity: number }
// Deterministic synthetic daily prices; no market data or network connection.
export function syntheticSeries() {
  const dates: string[] = [], prices: number[] = []
  const d = new Date('2024-01-01T00:00:00Z')
  for (let i = 0; i < 1040; i++) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      const n = prices.length
      prices.push(100 * Math.exp(n * 0.00048 + 0.075 * Math.sin(n / 19) + 0.025 * Math.sin(n / 4.8)))
      dates.push(d.toISOString().slice(0, 10))
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return { dates, prices }
}
export function backtest(c: BacktestConfig): BacktestResult {
  if (!c.start || !c.end || c.start >= c.end || c.start < '2024-01-01' || c.end > '2026-10-27' || !Number.isFinite(c.capital) || c.capital < 100000 || c.capital > 1000000000 || !Number.isFinite(c.fee) || c.fee < 0 || c.fee > 2 || !Number.isFinite(c.slippage) || c.slippage < 0 || c.slippage > 2) throw new Error('기간(2024-01-01~2026-10-27), 초기 자금(10만~10억원), 비용(0~2%)을 확인하세요.')
  const series = syntheticSeries()
  const indices = series.dates.map((d, i) => d >= c.start && d <= c.end ? i : -1).filter(i => i >= 0)
  if (indices.length < 30) throw new Error('최소 30거래일 이상으로 기간을 설정하세요.')
  let cash = c.capital, shares = 0, peak = c.capital, drawdown = 0, trades = 0, wins = 0, closed = 0, entryCost = 0
  const points: number[] = [], benchmark: number[] = [], dates: string[] = []
  const fee = c.fee / 100, slip = c.slippage / 100
  const first = series.prices[indices[0]]
  for (const i of indices) {
    const price = series.prices[i]
    // Signals use completed previous-day closes and execute on the next synthetic close.
    const history = series.prices.slice(Math.max(0, i - 20), i)
    if (history.length === 20) {
      const fast = history.slice(-5).reduce((a, b) => a + b, 0) / 5
      const slow = history.reduce((a, b) => a + b, 0) / 20
      const previous = history[19]
      const buy = c.strategy === 'reversion' ? previous < slow * 0.975 : c.strategy === 'breakout' ? previous >= Math.max(...history.slice(0, -1)) : fast > slow
      const sell = c.strategy === 'reversion' ? previous > slow : c.strategy === 'breakout' ? previous < slow : fast < slow
      if (!shares && buy) {
        shares = Math.floor(cash / (price * (1 + slip) * (1 + fee)))
        if (shares) { entryCost = shares * price * (1 + slip) * (1 + fee); cash -= entryCost; trades++ }
      } else if (shares && sell) {
        const proceeds = shares * price * (1 - slip) * (1 - fee)
        if (proceeds > entryCost) wins++
        closed++; cash += proceeds; shares = 0; trades++
      }
    }
    const value = cash + shares * price
    peak = Math.max(peak, value); drawdown = Math.max(drawdown, (peak - value) / peak * 100)
    points.push(value); benchmark.push(c.capital * price / first); dates.push(series.dates[i])
  }
  const finalEquity = points.at(-1)!
  return { points, benchmark, dates, finalEquity, totalReturn: (finalEquity / c.capital - 1) * 100, maxDrawdown: drawdown, trades, winRate: closed ? wins / closed * 100 : 0 }
}
