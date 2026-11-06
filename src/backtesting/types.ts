export type StrategyId = 'sma' | 'reversion' | 'breakout' | 'triple'
export type Adjustment = 'unadjusted' | 'adjusted' | 'unknown'
export interface PriceBar { date: string; open?: number; high?: number; low?: number; close: number; volume?: number }
export interface Dataset {
  name: string; symbol: string; source: string; kind: 'historical' | 'synthetic'; adjustment: Adjustment
  sha256: string; bars: PriceBar[]; warnings: string[]
}
export interface Config {
  strategy: StrategyId; start: string; end: string; capital: number
  fee: number; slippage: number; sellTax: number; allocation: number
  execution: 'next-open' | 'next-close'; fast: number; slow: number; threshold: number
}
export interface Fill {
  date: string; signalDate: string; side: 'buy' | 'sell'; quantity: number; rawPrice: number; price: number
  notional: number; fee: number; tax: number; slippage: number; cashAfter: number; sharesAfter: number; realizedPnl: number | null
}
export interface DailyPoint { date: string; equity: number; benchmark: number; cash: number; shares: number; drawdown: number }
export interface Result {
  config: Config; dataset: Omit<Dataset, 'bars'> & { rows: number; first: string; last: string }
  daily: DailyPoint[]; fills: Fill[]; totalReturn: number; benchmarkReturn: number; cagr: number | null
  maxDrawdown: number; winRate: number | null; closedTrades: number; profitFactor: number | null
  fees: number; taxes: number; slippageCost: number; finalEquity: number; finalCash: number; finalShares: number
  warmupRows: number; warnings: string[]
}
export const strategies: { id: StrategyId; name: string; description: string }[] = [
  { id: 'triple', name: '삼중 모멘텀 · ROC 5/15/25', description: '세 기간 수익률 합이 기준선을 상향 돌파하면 매수, 하향 이탈하면 매도' },
  { id: 'sma', name: '이동평균 모멘텀', description: '전일 단기 평균 > 장기 평균이면 매수, 반대이면 매도' },
  { id: 'reversion', name: '평균 회귀', description: '전일 종가가 장기 평균보다 2.5% 낮으면 매수, 평균 회복 시 매도' },
  { id: 'breakout', name: '종가 돌파', description: '전일 종가가 앞선 장기 기간 최고 종가를 돌파하면 매수, 장기 평균 하회 시 매도' },
]
export const defaultConfig: Config = { strategy: 'triple', start: '', end: '', capital: 10000000, fee: 0.015, slippage: 0.05, sellTax: 0, allocation: 100, execution: 'next-close', fast: 5, slow: 20, threshold: 4 }
