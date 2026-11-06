import { validDate } from './data'
import { strategies } from './types'
import type { Config, Dataset, DailyPoint, Fill, Result } from './types'

export function lookback(c: Config): number {
  return c.strategy === 'triple' ? 27 : c.strategy === 'breakout' ? c.slow + 1 : c.slow
}
function validate(c: Config, data: Dataset) {
  if (!strategies.some(s => s.id === c.strategy)) throw new Error('지원하는 전략을 선택하세요.')
  if (!validDate(c.start) || !validDate(c.end) || c.start > c.end) throw new Error('실제 달력 날짜로 시작일과 종료일을 확인하세요.')
  for (const [key, min, max] of [['capital', 100000, 1e9], ['fee', 0, 2], ['slippage', 0, 2], ['sellTax', 0, 2], ['allocation', 1, 100]] as const) {
    if (!Number.isFinite(c[key]) || c[key] < min || c[key] > max) throw new Error(`${key}: 허용 범위 ${min}~${max}를 확인하세요.`)
  }
  if (!['next-open', 'next-close'].includes(c.execution)) throw new Error('다음 거래일 시가 또는 종가 체결을 선택하세요.')
  if (![c.fast, c.slow].every(n => Number.isInteger(n) && n >= 1 && n <= 250) || (c.strategy === 'sma' && c.fast >= c.slow)) throw new Error('평균 기간은 1~250의 정수이며 단기는 장기보다 작아야 합니다.')
  if (!Number.isFinite(c.threshold) || c.threshold < -50 || c.threshold > 50) throw new Error('삼중 모멘텀 기준선은 -50~50%로 입력하세요.')
  if (!data.bars.length || data.bars.length > 100000) throw new Error('먼저 1~100,000행의 가격 데이터를 불러오세요.')
  for (let i = 0; i < data.bars.length; i++) {
    const b = data.bars[i]
    if (!validDate(b.date) || (i > 0 && b.date <= data.bars[i - 1].date) || !Number.isFinite(b.close) || b.close <= 0 || b.close > 1e12) throw new Error('가격 자료의 날짜 순서·중복·종가를 확인하세요.')
    if (c.execution === 'next-open' && (!Number.isFinite(b.open) || b.open! <= 0 || b.open! > 1e12)) throw new Error('시가 체결에는 모든 행의 유효한 open(시가)이 필요합니다.')
  }
  if (c.start < data.bars[0].date || c.end > data.bars.at(-1)!.date) throw new Error(`분석 기간은 보유 자료(${data.bars[0].date}~${data.bars.at(-1)!.date}) 안에서 선택하세요.`)
}
function average(prices: number[], start: number, end: number) {
  let sum = 0
  for (let i = start; i <= end; i++) sum += prices[i]
  return sum / (end - start + 1)
}
function signals(prices: number[], j: number, c: Config): { buy: boolean; sell: boolean } {
  if (c.strategy === 'triple') {
    const momentum = (i: number) => [5, 15, 25].reduce((sum, period) => sum + (prices[i] / prices[i - period] - 1) * 100, 0)
    const now = momentum(j), previous = momentum(j - 1)
    return { buy: previous <= c.threshold && now > c.threshold, sell: previous >= c.threshold && now < c.threshold }
  }
  const slow = average(prices, j - c.slow + 1, j)
  if (c.strategy === 'sma') {
    const fast = average(prices, j - c.fast + 1, j)
    return { buy: fast > slow, sell: fast < slow }
  }
  if (c.strategy === 'reversion') return { buy: prices[j] < slow * 0.975, sell: prices[j] >= slow }
  let highest = -Infinity
  for (let i = j - c.slow; i < j; i++) highest = Math.max(highest, prices[i])
  return { buy: prices[j] > highest, sell: prices[j] < slow }
}
function buyQuantity(cash: number, rawPrice: number, c: Config) {
  const price = rawPrice * (1 + c.slippage / 100), unitCost = price * (1 + c.fee / 100)
  let quantity = Math.floor(cash * (c.allocation / 100) / unitCost)
  if (!Number.isSafeInteger(quantity)) throw new Error('가격 단위와 초기 자금을 확인하세요. 주문 수량이 허용 정밀도를 초과합니다.')
  if (quantity * unitCost > cash && quantity > 0) quantity--
  return { price, quantity }
}
export function runBacktest(config: Config, dataset: Dataset): Result {
  const c = { ...config }
  validate(c, dataset)
  const { bars } = dataset, prices = bars.map(b => b.close)
  const selected = bars.map((b, i) => b.date >= c.start && b.date <= c.end ? i : -1).filter(i => i >= 0)
  if (selected.length < 2) throw new Error('분석 기간에 최소 2개의 거래일이 필요합니다.')
  const warmup = lookback(c), first = selected[0]
  if (c.strategy !== 'triple' && first < warmup) throw new Error(`시작일 앞에 지표 준비용 가격 ${warmup}행이 필요합니다. 시작일을 늦추거나 더 오래된 CSV를 불러오세요.`)
  let cash = c.capital, shares = 0, entryCost = 0, peak = c.capital, maxDrawdown = 0
  let fees = 0, taxes = 0, slippageCost = 0, closedTrades = 0, wins = 0, grossProfit = 0, grossLoss = 0
  const fills: Fill[] = [], daily: DailyPoint[] = []
  const feeRate = c.fee / 100, taxRate = c.sellTax / 100
  const rawPriceAt = (i: number) => c.execution === 'next-open' ? bars[i].open! : bars[i].close
  const benchmarkBuy = buyQuantity(c.capital, rawPriceAt(first), c)
  const benchmarkCash = c.capital - benchmarkBuy.quantity * benchmarkBuy.price * (1 + c.fee / 100)
  for (const i of selected) {
    const signal = c.strategy === 'triple' && (i - 1 < first || i - 1 < 26) ? { buy: false, sell: false } : signals(prices, i - 1, c)
    const rawPrice = rawPriceAt(i)
    if (!shares && signal.buy) {
      const buy = buyQuantity(cash, rawPrice, c)
      if (buy.quantity > 0) {
        shares = buy.quantity
        const notional = shares * buy.price, fee = notional * feeRate, slippage = (buy.price - rawPrice) * shares
        entryCost = notional + fee
        cash = Math.max(0, cash - entryCost); fees += fee; slippageCost += slippage
        fills.push({ date: bars[i].date, signalDate: bars[i - 1].date, side: 'buy', quantity: shares, rawPrice, price: buy.price, notional, fee, tax: 0, slippage, cashAfter: cash, sharesAfter: shares, realizedPnl: null })
      }
    } else if (shares && signal.sell) {
      const quantity = shares, price = rawPrice * (1 - c.slippage / 100), notional = quantity * price
      const fee = notional * feeRate, tax = notional * taxRate, slippage = (rawPrice - price) * quantity
      const proceeds = notional - fee - tax, realizedPnl = proceeds - entryCost
      cash += proceeds; shares = 0; closedTrades++; fees += fee; taxes += tax; slippageCost += slippage
      if (realizedPnl > 0) { wins++; grossProfit += realizedPnl } else grossLoss += -realizedPnl
      fills.push({ date: bars[i].date, signalDate: bars[i - 1].date, side: 'sell', quantity, rawPrice, price, notional, fee, tax, slippage, cashAfter: cash, sharesAfter: 0, realizedPnl })
    }
    const equity = cash + shares * bars[i].close
    if (!Number.isFinite(equity)) throw new Error('가격 또는 자금이 계산 가능한 범위를 벗어납니다.')
    peak = Math.max(peak, equity)
    const drawdown = (peak - equity) / peak * 100
    maxDrawdown = Math.max(maxDrawdown, drawdown)
    daily.push({ date: bars[i].date, equity, benchmark: benchmarkCash + benchmarkBuy.quantity * bars[i].close, cash, shares, drawdown })
  }
  const finalEquity = daily.at(-1)!.equity, elapsedDays = (Date.parse(daily.at(-1)!.date) - Date.parse(daily[0].date)) / 86400000
  const annualized = elapsedDays > 0 ? (Math.pow(finalEquity / c.capital, 365.25 / elapsedDays) - 1) * 100 : NaN
  const cagr = Number.isFinite(annualized) ? annualized : null
  const { bars: _bars, ...meta } = dataset
  void _bars
  return {
    config: c, dataset: { ...meta, rows: bars.length, first: bars[0].date, last: bars.at(-1)!.date }, daily, fills,
    totalReturn: (finalEquity / c.capital - 1) * 100,
    benchmarkReturn: (daily.at(-1)!.benchmark / c.capital - 1) * 100,
    cagr,
    maxDrawdown, winRate: closedTrades ? wins / closedTrades * 100 : null, closedTrades,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    fees, taxes, slippageCost, finalEquity, finalCash: cash, finalShares: shares, warmupRows: first,
    warnings: [...dataset.warnings, ...(c.strategy === 'triple' && first < 26 ? ['분석 초반의 교차 지표 준비 구간은 현금 보유일로 포함합니다. 분석 시작일 이전 신호는 체결하지 않습니다.'] : []), '배당·분배금·이자·기업행사 현금흐름 및 호가 단위·거래량 제약은 반영하지 않습니다.', '마지막 보유분은 종가로 평가합니다. 강제 청산과 미실현 청산 비용은 반영하지 않습니다.'],
  }
}
export function initialRange(data: Dataset, config: Config): Pick<Config, 'start' | 'end' | 'execution'> {
  if (config.strategy === 'triple') return { start: data.bars[0].date, end: data.bars.at(-1)!.date, execution: config.execution === 'next-open' && data.bars.every(b => b.open !== undefined) ? 'next-open' : 'next-close' }
  const end = data.bars.at(-1)!.date, startDate = new Date(`${end}T00:00:00Z`)
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 2)
  const suggested = data.bars.findIndex((b, i) => i >= lookback(config) && b.date >= startDate.toISOString().slice(0, 10))
  const first = suggested >= 0 ? suggested : Math.min(lookback(config), data.bars.length - 1)
  return { start: data.bars[first].date, end, execution: data.bars.every(b => b.open !== undefined) ? config.execution : 'next-close' }
}
export function chartRows(points: DailyPoint[], limit = 500): DailyPoint[] {
  if (points.length <= limit) return points
  const indices = new Set<number>([0, points.length - 1]), bucket = Math.ceil(points.length / ((limit - 2) / 2))
  for (let start = 0; start < points.length; start += bucket) {
    let lo = start, hi = start
    for (let i = start; i < Math.min(points.length, start + bucket); i++) {
      if (points[i].equity < points[lo].equity) lo = i
      if (points[i].equity > points[hi].equity) hi = i
    }
    indices.add(lo); indices.add(hi)
  }
  return [...indices].sort((a, b) => a - b).map(i => points[i])
}
