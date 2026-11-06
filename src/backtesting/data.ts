import type { Adjustment, Dataset, PriceBar } from './types'

export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function dateValue(raw: string, line: number) {
  let value = raw.trim().replace(/[./]/g, '-')
  if (/^\d{8}$/.test(value)) value = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}`
  if (!validDate(value)) throw new Error(`${line}행: 날짜는 실제 달력의 YYYY-MM-DD 또는 YYYYMMDD여야 합니다.`)
  const day = new Date(`${value}T00:00:00Z`).getUTCDay()
  if (day === 0 || day === 6) throw new Error(`${line}행: 주말 가격 행(${value})을 확인하세요.`)
  return value
}
const normalize = (v: string) => v.trim().toLowerCase().replace(/[\s_()-]/g, '')
const aliases: Record<string, string[]> = {
  date: ['date', '날짜', '일자', '거래일', '거래일자'],
  open: ['open', '시가'], high: ['high', '고가'], low: ['low', '저가'],
  close: ['close', '종가', '현재가', '종가원'], volume: ['volume', '거래량', '거래량주'],
  kind: ['datakind'],
  symbol: ['symbol', 'ticker', '종목코드', '종목번호', '단축코드'],
}
// Quoted delimiters, escaped quotes and CRLF are handled without silently dropping malformed rows.
function rows(text: string): string[][] {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0]
  const delimiter = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ','
  const result: string[][] = []; let row: string[] = [], field = '', quoted = false, afterQuote = false
  const input = text.replace(/^\uFEFF/, '')
  for (let i = 0; i <= input.length; i++) {
    const c = input[i]
    if (quoted) {
      if (c === undefined) throw new Error('CSV 따옴표가 닫히지 않았습니다.')
      if (c === '"') { if (input[i + 1] === '"') { field += '"'; i++ } else { quoted = false; afterQuote = true } }
      else field += c
      continue
    }
    if (c === '"') {
      if (field.trim() || afterQuote) throw new Error('CSV 필드의 따옴표 위치가 올바르지 않습니다.')
      field = ''; quoted = true; continue
    }
    if (c === delimiter || c === '\n' || c === '\r' || c === undefined) {
      row.push(field); field = ''; afterQuote = false
      if (c !== delimiter) {
        if (row.some(v => v.trim() !== '')) result.push(row)
        row = []
        if (c === '\r' && input[i + 1] === '\n') i++
      }
    } else {
      if (afterQuote && c.trim()) throw new Error('CSV 닫는 따옴표 뒤에 불필요한 문자가 있습니다.')
      if (!afterQuote) field += c
    }
  }
  return result
}
function price(raw: string, label: string, line: number, allowZero = false) {
  const clean = raw.trim().replaceAll(',', '')
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(clean)) throw new Error(`${line}행: ${label} 숫자를 확인하세요.`)
  const value = Number(clean)
  if (!Number.isFinite(value) || value > 1e12 || (allowZero ? value < 0 : value <= 0)) throw new Error(`${line}행: ${label} 범위가 올바르지 않습니다.`)
  return value
}
export interface ImportInfo { name: string; symbol: string; source: string; adjustment: Adjustment; sha256: string; kind?: Dataset['kind'] }
export function parseCsv(text: string, info: ImportInfo): Dataset {
  if (text.length > 20 * 1024 * 1024) throw new Error('CSV는 20MB 이하로 불러오세요.')
  const table = rows(text)
  if (table.length < 3 || table.length > 100001) throw new Error('CSV는 헤더와 2~100,000개의 가격 행이 필요합니다.')
  const headers = table[0].map(normalize), indices: Record<string, number> = {}
  if (new Set(headers).size !== headers.length) throw new Error('중복된 CSV 열 이름을 확인하세요.')
  for (const [key, names] of Object.entries(aliases)) {
    const hits = headers.map((h, i) => names.includes(h) ? i : -1).filter(i => i >= 0)
    if (hits.length > 1) throw new Error(`${key}에 해당하는 열이 여러 개입니다.`)
    indices[key] = hits[0] ?? -1
  }
  if (indices.date < 0 || indices.close < 0) throw new Error('필수 열은 date(일자), close(종가)입니다. 시가 체결에는 open(시가)도 필요합니다.')
  const warnings: string[] = [], seen = new Set<string>(), symbols = new Set<string>(), kinds = new Set<string>()
  const bars: PriceBar[] = table.slice(1).map((row, i) => {
    const line = i + 2
    if (row.length !== headers.length) throw new Error(`${line}행: 열 개수가 헤더와 다릅니다. 천 단위 쉼표는 따옴표로 감싸세요.`)
    const date = dateValue(row[indices.date], line)
    if (seen.has(date)) throw new Error(`${line}행: 중복 날짜 ${date}가 있습니다.`)
    seen.add(date)
    if (indices.symbol >= 0) {
      let symbol = row[indices.symbol].trim().replace(/^A(?=\d{6}$)/, '')
      if (/^\d{1,6}$/.test(symbol)) symbol = symbol.padStart(6, '0')
      if (!symbol) throw new Error(`${line}행: 종목코드가 비어 있습니다.`)
      symbols.add(symbol)
    }
    if (indices.kind >= 0) {
      const kind = row[indices.kind].trim()
      if (!['historical', 'synthetic'].includes(kind)) throw new Error(`${line}행: data_kind는 historical 또는 synthetic이어야 합니다.`)
      kinds.add(kind)
    }
    const bar: PriceBar = { date, close: price(row[indices.close], '종가', line) }
    for (const key of ['open', 'high', 'low', 'volume'] as const) {
      if (indices[key] >= 0) bar[key] = price(row[indices[key]], key, line, key === 'volume')
    }
    if (bar.high !== undefined && bar.low !== undefined && bar.high < bar.low) throw new Error(`${line}행: 고가가 저가보다 낮습니다.`)
    for (const value of [bar.close, bar.open].filter((n): n is number => n !== undefined)) {
      if ((bar.high !== undefined && value > bar.high) || (bar.low !== undefined && value < bar.low)) throw new Error(`${line}행: 가격이 고가·저가 범위를 벗어납니다. 수정주가 혼합 여부를 확인하세요.`)
    }
    return bar
  })
  if (kinds.size > 1) throw new Error('가상 가격과 과거 가격을 한 CSV에 섞을 수 없습니다.')
  if (symbols.size > 1) throw new Error('한 CSV에는 한 종목만 포함하세요. 여러 종목의 가격을 섞을 수 없습니다.')
  const symbol = [...symbols][0] ?? info.symbol.trim()
  if (!symbol || !/^[A-Za-z0-9.^_-]{1,24}$/.test(symbol)) throw new Error('종목코드(예: 229200)를 입력하세요.')
  if (symbols.size && info.symbol.trim() && symbol !== info.symbol.trim()) throw new Error(`입력 종목코드(${info.symbol})와 CSV 종목코드(${symbol})가 다릅니다.`)
  if (bars.some((b, i) => i > 0 && b.date < bars[i - 1].date)) warnings.push('날짜를 과거→최근 순으로 정렬했습니다.')
  bars.sort((a, b) => a.date.localeCompare(b.date))
  if (bars.some((b, i) => i > 0 && Date.parse(b.date) - Date.parse(bars[i - 1].date) > 10 * 86400000)) warnings.push('10일을 넘는 날짜 간격이 있습니다. 휴장·거래정지·누락 여부를 원본과 확인하세요. 가격을 보간하지 않았습니다.')
  if (indices.open < 0) warnings.push('시가 열이 없어 다음 거래일 종가 체결만 사용할 수 있습니다.')
  if (headers.some(h => ['adjclose', 'adjustedclose', '수정종가'].includes(h))) warnings.push('별도 수정종가 열은 사용하지 않았습니다. 종가와 OHLC의 조정 기준을 확인하세요.')
  if (info.adjustment === 'unknown') warnings.push('가격 조정 여부가 미확인입니다. 기업행사에 따른 가격 단절이 신호와 성과에 영향을 줄 수 있습니다.')
  return { ...info, name: info.name.trim() || symbol, source: info.source.trim() || '사용자 CSV · 원 출처 미입력', symbol, kind: kinds.has('synthetic') ? 'synthetic' : info.kind ?? 'historical', bars, warnings }
}
export function decodeCsv(buffer: ArrayBuffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  catch { return new TextDecoder('euc-kr', { fatal: true }).decode(buffer) }
}
export async function fingerprint(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('')
}
