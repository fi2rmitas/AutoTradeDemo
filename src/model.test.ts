import { describe, expect, it } from 'vitest'
import { DAY_BASELINE, backtest, equity, fillOrder, freshState, halt, placeOrder, reservedCash, resume, saveLimits, toggleStrategy, validateOrder } from './model'
import { parseSavedState } from './persistence'

describe('가상 주문 장부', () => {
  it('초기 자산과 평가·실현손익이 일치한다', () => {
    const s = freshState()
    expect(equity(s)).toBe(33500000)
    const unrealized = s.positions.reduce((n, p) => n + p.quantity * ({ '005930': 72400, '000660': 183500, '035420': 191500, '005380': 241000, '069500': 35650 }[p.symbol]! - p.average), 0)
    expect(s.realized + unrealized).toBe(equity(s) - 30000000)
  })
  it('매수 체결 시 현금, 수량, 가중평균 단가를 함께 갱신한다', () => {
    const s = freshState(), next = fillOrder(s, 'SIM-1028')
    const p = next.positions.find(x => x.symbol === '005930')!
    expect(next.cash).toBe(s.cash - 362000)
    expect(p.quantity).toBe(105)
    expect(p.average).toBeCloseTo((68000 * 100 + 72400 * 5) / 105)
    expect(equity(next)).toBe(equity(s))
    expect(reservedCash(next)).toBe(0)
    expect(() => fillOrder(next, 'SIM-1028')).toThrow(/대기/)
    expect(s.positions[0].quantity).toBe(100)
  })
  it('매도 체결 시 보유수량과 실현손익을 갱신한다', () => {
    const s = freshState(), pending = placeOrder(s, 'momentum', 'sell', 3), next = fillOrder(pending, pending.orders[0].id)
    expect(next.positions.find(p => p.symbol === '005930')!.quantity).toBe(97)
    expect(next.cash).toBe(s.cash + 72400 * 3)
    expect(next.realized).toBe(s.realized + (72400 - 68000) * 3)
    expect(equity(next)).toBe(equity(s))
  })
  it('대기 주문의 예약 현금을 중복 사용하지 않는다', () => {
    const s = freshState(); s.cash = 2000000; s.limits.dailyLoss = 20; s.orders[0].quantity = 25
    expect(() => placeOrder(s, 'momentum')).toThrow(/가용 현금/)
  })
  it('대기 매도 수량을 중복 사용하지 않는다', () => {
    const s = placeOrder(freshState(), 'momentum', 'sell', 30)
    const second = placeOrder(s, 'momentum', 'sell', 30), third = placeOrder(second, 'momentum', 'sell', 30)
    expect(() => placeOrder(third, 'momentum', 'sell', 11)).toThrow(/수량/)
  })
  it('주문 금액과 종목 비중 한도를 적용한다', () => {
    const s = freshState()
    expect(() => placeOrder(s, 'momentum', 'buy', 100)).toThrow(/금액 한도/)
    s.limits.position = 21
    expect(() => placeOrder(s, 'momentum')).toThrow(/투자 비중/)
  })
  it('일일 손실 한도를 적용한다', () => {
    const s = freshState(); s.cash -= 3000000
    expect(equity(s)).toBeLessThan(DAY_BASELINE * 0.97)
    expect(() => placeOrder(s, 'momentum')).toThrow(/일일 손실/)
  })
  it('잘못된 수량과 NaN 한도를 거부한다', () => {
    const s = freshState()
    expect(() => validateOrder(s, '005930', 'buy', 0)).toThrow(/정수/)
    expect(() => validateOrder(s, '005930', 'buy', 1.5)).toThrow(/정수/)
    expect(() => saveLimits(s, { ...s.limits, order: NaN })).toThrow()
  })
  it('체결 전에 변경된 위험 한도도 다시 검증한다', () => {
    const s = freshState(); s.limits.order = 10000
    expect(() => fillOrder(s, 'SIM-1028')).toThrow(/금액 한도/)
  })
})
describe('긴급 중지와 복원', () => {
  it('중지는 전략과 미체결만 정리하고 보유분을 유지한다', () => {
    const s = freshState(), stopped = halt(s)
    expect(stopped.halted).toBe(true)
    expect(stopped.strategies.every(x => !x.running)).toBe(true)
    expect(stopped.orders.every(x => x.status !== 'pending')).toBe(true)
    expect(stopped.positions).toEqual(s.positions)
    expect(stopped.cash).toBe(s.cash)
    expect(() => toggleStrategy(stopped, 'momentum')).toThrow(/긴급 중지/)
    expect(() => fillOrder(stopped, 'SIM-1028')).toThrow(/긴급 중지/)
    const restored = resume(stopped)
    expect(restored.halted).toBe(false)
    expect(restored.strategies.every(x => !x.running)).toBe(true)
    expect(() => placeOrder(restored, 'momentum')).toThrow(/실행 중/)
  })
  it('새로고침용 직렬화가 긴급 중지와 장부를 보존한다', () => {
    const stopped = halt(fillOrder(freshState(), 'SIM-1028'))
    expect(parseSavedState(JSON.stringify(stopped))).toEqual(stopped)
  })
  it('손상된 저장 값과 알 수 없는 종목을 초기값으로 복원한다', () => {
    expect(parseSavedState('{')).toEqual(freshState())
    const s = freshState(); s.positions[0].symbol = 'UNKNOWN'
    expect(parseSavedState(JSON.stringify(s))).toEqual(freshState())
    expect(parseSavedState(JSON.stringify({ version: 1 }))).toEqual(freshState())
  })
})
describe('독립 합성 데이터 백테스트', () => {
  const config = { strategy: 'momentum', start: '2025-01-01', end: '2026-10-27', capital: 30000000, fee: 0.015, slippage: 0.05 }
  it('동일 설정은 동일한 결과를 만들고 지표가 유한하다', () => {
    const r = backtest(config)
    expect(backtest(config)).toEqual(r)
    expect(r.trades).toBeGreaterThan(0)
    expect(r.points.length).toBe(r.dates.length)
    expect(r.finalEquity).toBeGreaterThan(0)
    expect(r.maxDrawdown).toBeGreaterThanOrEqual(0)
    expect(r.totalReturn).toBeCloseTo((r.finalEquity / config.capital - 1) * 100)
  })
  it('비용이 결과에 반영되고 전략별 결과가 달라진다', () => {
    expect(backtest(config).finalEquity).toBeLessThan(backtest({ ...config, fee: 0, slippage: 0 }).finalEquity)
    expect(backtest({ ...config, strategy: 'reversion' }).points).not.toEqual(backtest(config).points)
  })
  it('잘못된 기간, 짧은 기간과 무한 자금을 거부한다', () => {
    expect(() => backtest({ ...config, end: '2024-01-01' })).toThrow()
    expect(() => backtest({ ...config, end: '2025-01-20' })).toThrow(/30거래일/)
    expect(() => backtest({ ...config, capital: Infinity })).toThrow()
  })
})

