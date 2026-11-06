import { describe, expect, it } from 'vitest'
import { chartRows, initialRange, runBacktest } from './engine'
import { defaultConfig } from './types'
import type { Config, Dataset, PriceBar } from './types'
function dataset(closes: number[], opens = closes): Dataset {
  const bars: PriceBar[] = [], d = new Date('2024-01-01T00:00:00Z')
  for (let i = 0; i < closes.length; i++) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1)
    bars.push({ date: d.toISOString().slice(0, 10), open: opens[i], close: closes[i] }); d.setUTCDate(d.getUTCDate() + 1)
  }
  return { name: '검증용 가격', symbol: 'DEMO', kind: 'synthetic', source: '수기 검산 fixture', adjustment: 'unadjusted', sha256: 'b'.repeat(64), warnings: [], bars }
}
function config(data: Dataset, start = 2): Config { return { ...defaultConfig, strategy: 'sma', execution: 'next-open', fast: 1, slow: 2, fee: 0, slippage: 0, capital: 100000, start: data.bars[start].date, end: data.bars.at(-1)!.date } }
describe('과거 가격 백테스트 회계와 체결', () => {
  it('전일 신호를 다음 거래일 시가에 체결하고 비용을 수기로 검산할 수 있다', () => {
    const data = dataset([100, 110, 90, 80, 80], [100, 110, 100, 120, 80])
    const c = { ...config(data), fee: 1, slippage: 1, sellTax: 1 }, r = runBacktest(c, data)
    expect(r.fills).toHaveLength(2)
    expect(r.fills[0].signalDate).toBe(data.bars[1].date)
    expect(r.fills[0].date).toBe(data.bars[2].date)
    expect(r.fills[0].quantity).toBe(980)
    expect(r.fills[0].price).toBe(101)
    expect(r.fills[0].fee).toBeCloseTo(989.8)
    expect(r.fills[0].cashAfter).toBeCloseTo(30.2)
    expect(r.fills[1].price).toBeCloseTo(118.8)
    expect(r.fills[1].fee).toBeCloseTo(1164.24)
    expect(r.fills[1].tax).toBeCloseTo(1164.24)
    expect(r.finalCash).toBeCloseTo(114125.72)
    expect(r.fills[1].realizedPnl).toBeCloseTo(14125.72)
    expect(r.fees).toBeCloseTo(989.8 + 1164.24)
    expect(r.taxes).toBeCloseTo(1164.24)
    expect(r.slippageCost).toBeCloseTo(980 + 1176)
    expect(r.closedTrades).toBe(1)
    expect(r.winRate).toBe(100)
    expect(r.profitFactor).toBeNull()
  })
  it('다음 거래일 종가 모드도 신호일 종가로 체결하지 않는다', () => {
    const data = dataset([100, 110, 120, 80, 90])
    const r = runBacktest({ ...config(data), execution: 'next-close' }, data)
    expect(r.fills[0].rawPrice).toBe(120)
    expect(r.fills[0].signalDate).toBe(data.bars[1].date)
    expect(r.fills.every(f => f.signalDate < f.date)).toBe(true)
  })
  it('초기 자산을 포함한 최대 낙폭과 일별 장부가 일치한다', () => {
    const data = dataset([100, 110, 120, 80, 90]), r = runBacktest(config(data), data)
    expect(r.daily[0].equity).toBe(100000)
    expect(r.daily[1].equity).toBe(66680)
    expect(r.maxDrawdown).toBeCloseTo(33.32)
    expect(r.finalEquity).toBe(75010)
    for (const p of r.daily) {
      const close = data.bars.find(b => b.date === p.date)!.close
      expect(p.equity).toBeCloseTo(p.cash + p.shares * close)
      expect(p.cash).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(p.shares)).toBe(true)
    }
  })
  it('기간 말 보유분을 평가하며 강제 매도 비용을 만들지 않는다', () => {
    const data = dataset([100, 110, 120, 130]), r = runBacktest({ ...config(data), sellTax: 1 }, data)
    expect(r.fills).toHaveLength(1)
    expect(r.finalShares).toBeGreaterThan(0)
    expect(r.taxes).toBe(0)
    expect(r.closedTrades).toBe(0)
    expect(r.winRate).toBeNull()
  })
  it('매수 후 보유도 동일한 시점·비중·매수 비용으로 비교한다', () => {
    const data = dataset([100, 110, 120, 130]), r = runBacktest({ ...config(data), fee: 0.1, slippage: 0.1, allocation: 70 }, data)
    expect(r.daily[0].benchmark).toBeCloseTo(r.daily[0].equity)
    expect(r.daily[1].benchmark).toBeCloseTo(r.daily[1].equity)
    expect(r.finalCash).toBeGreaterThanOrEqual(30000)
  })
  it('신호가 없으면 자산은 초기 자금이고 승률은 미정이다', () => {
    const data = dataset([100, 100, 100, 100, 100]), r = runBacktest(config(data), data)
    expect(r.totalReturn).toBe(0)
    expect(r.maxDrawdown).toBe(0)
    expect(r.fills).toHaveLength(0)
    expect(r.winRate).toBeNull()
  })
  it('단가가 너무 높아 한 주도 못 사면 음수 현금을 만들지 않는다', () => {
    const data = dataset([1000000, 1100000, 1200000, 1300000]), r = runBacktest(config(data), data)
    expect(r.fills).toHaveLength(0)
    expect(r.finalCash).toBe(100000)
  })
})
describe('미래 데이터 격리와 전략 규칙', () => {
  it('미래 가격을 바꿔도 그 이전의 체결·평가가 바뀌지 않는다', () => {
    const data = dataset([100, 110, 120, 80, 90, 130, 100, 140, 90, 120]), future = structuredClone(data)
    for (let i = 7; i < future.bars.length; i++) { future.bars[i].open! *= 3; future.bars[i].close *= 4 }
    const r1 = runBacktest(config(data), data), r2 = runBacktest(config(data), future), boundary = data.bars[7].date
    expect(r1.daily.filter(p => p.date < boundary)).toEqual(r2.daily.filter(p => p.date < boundary))
    expect(r1.fills.filter(p => p.date < boundary)).toEqual(r2.fills.filter(p => p.date < boundary))
    expect(data.bars[7].close).toBe(140)
  })
  it('삼중 모멘텀은 이미 기준선 위라는 이유로 진입하지 않고 새 돌파만 처리한다', () => {
    const closes = Array(36).fill(100); closes[28] = 120; closes[29] = 120; closes[30] = 105; closes.fill(90, 31)
    const data = dataset(closes), r = runBacktest({ ...config(data, 27), strategy: 'triple', threshold: 4 }, data)
    expect(r.fills.map(f => [f.side, f.date, f.signalDate])).toEqual([['buy', data.bars[29].date, data.bars[28].date], ['sell', data.bars[32].date, data.bars[31].date]])
  })
  it('돌파는 전일을 제외한 이전 기간 고가와 비교한다', () => {
    const data = dataset([100, 110, 120, 80, 80, 80]), r = runBacktest({ ...config(data, 3), strategy: 'breakout' }, data)
    expect(r.fills[0].date).toBe(data.bars[3].date)
    expect(r.fills[0].signalDate).toBe(data.bars[2].date)
  })
  it('평균 회귀는 과매도에 진입하고 평균 회복 후 청산한다', () => {
    const data = dataset([100, 100, 90, 110, 100]), r = runBacktest({ ...config(data), strategy: 'reversion' }, data)
    expect(r.fills.map(f => f.side)).toEqual(['buy', 'sell'])
    expect(r.fills[0].date).toBe(data.bars[3].date)
  })
  it('같은 입력은 같은 결과를 만들고 입력 객체를 수정하지 않는다', () => {
    const data = dataset([100, 110, 120, 80, 90]), c = config(data), before = structuredClone({ data, c })
    expect(runBacktest(c, data)).toEqual(runBacktest(c, data))
    expect({ data, c }).toEqual(before)
  })
})
describe('입력 조건과 표시용 데이터', () => {
  it('준비 구간 부족·잘못된 기간·범위 초과를 명확하게 거부한다', () => {
    const data = dataset([100, 110, 120, 80, 90])
    expect(() => runBacktest({ ...config(data), start: data.bars[0].date }, data)).toThrow(/준비용/)
    expect(() => runBacktest({ ...config(data), start: '2024-02-30' }, data)).toThrow(/달력 날짜/)
    expect(() => runBacktest({ ...config(data), end: '2024-03-01' }, data)).toThrow(/보유 자료/)
  })
  it('시가 없는 자료를 시가 체결로 실행하거나 잘못된 조건을 넘길 수 없다', () => {
    const data = dataset([100, 110, 120, 80, 90]); delete data.bars[0].open
    expect(() => runBacktest(config(data), data)).toThrow(/시가/)
    expect(() => runBacktest({ ...config(data), fee: NaN }, data)).toThrow(/fee/)
    expect(() => runBacktest({ ...config(data), strategy: 'unknown' as Config['strategy'] }, data)).toThrow(/전략/)
    expect(() => runBacktest({ ...config(data), fast: 2, slow: 2 }, data)).toThrow(/단기/)
    expect(() => runBacktest({ ...config(data), execution: 'next-close' }, data)).not.toThrow()
  })
  it('자료 범위로 기본 기간과 체결 방법을 정한다', () => {
    const data = dataset(Array.from({ length: 60 }, (_, i) => 100 + i)), c: Config = { ...defaultConfig, strategy: 'sma', slow: 20 }
    expect(initialRange(data, c).start).toBe(data.bars[20].date)
    data.bars.forEach(b => delete b.open)
    expect(initialRange(data, c).execution).toBe('next-close')
  })
  it('차트만 축약하고 첫·끝·극값 및 원본 원장은 보존한다', () => {
    const points = Array.from({ length: 1000 }, (_, i) => ({ date: String(i), equity: i === 456 ? -100 : i === 789 ? 2000 : i, cash: 0, shares: 1, benchmark: i, drawdown: 0 }))
    const reduced = chartRows(points, 50)
    expect(reduced.length).toBeLessThanOrEqual(50)
    expect(reduced[0]).toEqual(points[0]); expect(reduced.at(-1)).toEqual(points.at(-1))
    expect(reduced).toContain(points[456]); expect(reduced).toContain(points[789]); expect(points.length).toBe(1000)
  })
})

describe('기존 코스닥150 삼중 모멘텀 기본 조건', () => {
  it('원본 기본값은 삼중 모멘텀·1천만원·익일 종가·기준선 4이다', () => {
    expect(defaultConfig).toMatchObject({ strategy: 'triple', capital: 10000000, execution: 'next-close', threshold: 4, fee: 0.015, slippage: 0.05, allocation: 100, sellTax: 0 })
  })
  it('초기 준비 기간을 현금으로 포함하고 전체 가격 구간을 선택한다', () => {
    const values = Array(36).fill(100); values[28] = 120; values[29] = 120; values[30] = 105; values.fill(90, 31)
    const data = dataset(values), range = initialRange(data, defaultConfig)
    expect(range).toEqual({ start: data.bars[0].date, end: data.bars.at(-1)!.date, execution: 'next-close' })
    const result = runBacktest({ ...defaultConfig, ...range }, data)
    expect(result.daily).toHaveLength(36)
    expect(result.daily.slice(0, 27).every(p => p.cash === defaultConfig.capital && p.shares === 0)).toBe(true)
    expect(result.fills[0].date).toBe(data.bars[29].date)
  })
  it('분석 시작일 전날의 교차 신호를 첫날 체결하지 않는다', () => {
    const values = Array(36).fill(100); values[28] = 120; values[29] = 120; values[30] = 105; values.fill(90, 31)
    const data = dataset(values), c = { ...defaultConfig, start: data.bars[29].date, end: data.bars.at(-1)!.date }
    expect(runBacktest(c, data).fills).toHaveLength(0)
  })
})
