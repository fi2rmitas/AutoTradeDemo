import { describe, expect, it } from 'vitest'
import { decodeCsv, parseCsv, validDate } from './data'
const info = { name: '테스트 가격', symbol: '229200', source: '검증용 fixture', adjustment: 'unadjusted' as const, sha256: 'a'.repeat(64) }
const plain = 'date,open,high,low,close,volume\n2024-01-02,100,120,90,110,0\n2024-01-03,110,120,100,115,10'
describe('가격 CSV 입력 검증', () => {
  it('한글 헤더, BOM, CRLF, 천 단위 쉼표를 읽는다', () => {
    const data = parseCsv('\uFEFF일자,시가,고가,저가,종가,거래량\r\n20240102,"1,000","1,200",900,"1,100",0\r\n20240103,"1,100","1,200","1,000","1,150",100\r\n', info)
    expect(data.bars[0]).toEqual({ date: '2024-01-02', open: 1000, high: 1200, low: 900, close: 1100, volume: 0 })
    expect(data.bars).toHaveLength(2)
  })
  it('CP949 파일을 디코딩하고 UTF-8도 보존한다', () => {
    const bytes = new Uint8Array([0xc0, 0xcf, 0xc0, 0xda, 0x2c, 0xc1, 0xbe, 0xb0, 0xa1])
    expect(decodeCsv(bytes.buffer)).toBe('일자,종가')
    expect(decodeCsv(new TextEncoder().encode('date,close\n').buffer)).toBe('date,close\n')
  })
  it('역순 데이터를 정렬하고 경고를 남긴다', () => {
    const data = parseCsv('date,close\n2024-01-03,110\n2024-01-02,100', info)
    expect(data.bars[0].date).toBe('2024-01-02')
    expect(data.warnings.join(' ')).toContain('정렬')
    expect(data.warnings.join(' ')).toContain('시가 열이 없어')
  })
  it('중복 날짜와 잘못된 날짜 및 주말을 거부한다', () => {
    expect(() => parseCsv('date,close\n2024-01-02,100\n2024-01-02,110', info)).toThrow(/중복 날짜/)
    expect(() => parseCsv('date,close\n2024-02-30,100\n2024-03-01,110', info)).toThrow(/날짜/)
    expect(() => parseCsv('date,close\n2024-01-06,100\n2024-01-08,110', info)).toThrow(/주말/)
    expect(validDate('2024-02-29')).toBe(true)
    expect(validDate('2023-02-29')).toBe(false)
  })
  it('누락 열, 중복 헤더, 열 개수 오류와 닫히지 않은 따옴표를 거부한다', () => {
    expect(() => parseCsv('date,price\n2024-01-02,100\n2024-01-03,110', info)).toThrow(/필수 열/)
    expect(() => parseCsv('date,close,close\n2024-01-02,100,100\n2024-01-03,110,110', info)).toThrow(/중복된/)
    expect(() => parseCsv('date,close\n2024-01-02,1,000\n2024-01-03,110', info)).toThrow(/열 개수/)
    expect(() => parseCsv('date,close\n2024-01-02,"100\n2024-01-03,110', info)).toThrow(/따옴표/)
  })
  it('음수·0·무한대·비숫자 가격과 잘못된 OHLC를 거부한다', () => {
    for (const value of ['0', '-1', 'NaN', 'Infinity', '1e309', '']) expect(() => parseCsv(`date,close\n2024-01-02,${value}\n2024-01-03,110`, info)).toThrow()
    expect(() => parseCsv(plain.replace('100,120,90,110', '100,105,90,110'), info)).toThrow(/고가·저가/)
    expect(() => parseCsv(plain.replace('100,120,90,110', '100,80,90,100'), info)).toThrow(/고가가 저가/)
  })
  it('여러 종목과 수동 입력 코드의 불일치를 거부한다', () => {
    expect(() => parseCsv('date,close,symbol\n2024-01-02,100,005930\n2024-01-03,110,229200', info)).toThrow(/여러 종목/)
    expect(() => parseCsv('date,close,symbol\n2024-01-02,100,005930\n2024-01-03,110,005930', info)).toThrow(/다릅니다/)
    expect(parseCsv('date,close,symbol\n2024-01-02,100,A229200\n2024-01-03,110,A229200', info).symbol).toBe('229200')
  })
  it('긴 누락 구간을 채우지 않고 경고한다', () => {
    const data = parseCsv('date,close\n2024-01-02,100\n2024-02-01,110', info)
    expect(data.bars).toHaveLength(2)
    expect(data.warnings.join(' ')).toContain('보간하지 않았습니다')
  })
  it('가상 형식 예제를 다시 불러와도 가상 데이터로 식별한다', () => {
    const data = parseCsv('date,close,data_kind\n2024-01-02,100,synthetic\n2024-01-03,110,synthetic', info)
    expect(data.kind).toBe('synthetic')
    expect(() => parseCsv('date,close,data_kind\n2024-01-02,100,synthetic\n2024-01-03,110,historical', info)).toThrow(/섞을 수 없습니다/)
  })
})
