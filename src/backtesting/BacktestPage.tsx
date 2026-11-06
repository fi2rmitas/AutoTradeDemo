import { useEffect, useRef, useState } from 'react'
import { Badge, Icon, LineChart, Panel, downloadCsv, money, pct, tone } from '../components'
import { syntheticSeries } from '../model'
import { decodeCsv, fingerprint, parseCsv } from './data'
import { chartRows, initialRange } from './engine'
import { defaultConfig, strategies } from './types'
import type { Adjustment, Config, Dataset, Result } from './types'
import type { RunResponse } from './backtest.worker'
import './backtesting.css'

export function exampleCsv(): string {
  const { dates, prices } = syntheticSeries()
  return ['date,open,high,low,close,volume,data_kind', ...dates.map((date, i) => {
    const close = Math.round(prices[i] * 100) / 100, open = i ? Math.round(prices[i - 1] * 100) / 100 : close
    return [date, open, (Math.max(open, close) + 1).toFixed(2), (Math.min(open, close) - 1).toFixed(2), close, 100000, 'synthetic'].join(',')
  })].join('\n')
}
function downloadText(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a')
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const adjustmentLabels = { unadjusted: '원주가 · 수정 미적용', adjusted: 'OHLC 동일 기준 수정주가', unknown: '조정 여부 미확인' }
export default function BacktestPage({ notify }: { notify: (text: string) => void }) {
  const [dataset, setDataset] = useState<Dataset | null>(null), [config, setConfig] = useState<Config>({ ...defaultConfig })
  const [result, setResult] = useState<Result | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false), [running, setRunning] = useState(false)
  const [name, setName] = useState('내 가격 CSV'), [symbol, setSymbol] = useState('229200'), [source, setSource] = useState('사용자 CSV · 원 출처 미확인'), [adjustment, setAdjustment] = useState<Adjustment>('unknown')
  const [chart, setChart] = useState('자산곡선'), [tradePage, setTradePage] = useState(0)
  const worker = useRef<Worker | null>(null), job = useRef(0), loadingJob = useRef(0)
  useEffect(() => () => { worker.current?.terminate(); loadingJob.current++ }, [])
  function cancel() { job.current++; worker.current?.terminate(); worker.current = null; setRunning(false) }
  function applyData(data: Dataset) {
    cancel(); setDataset(data); setConfig(c => ({ ...c, ...initialRange(data, c) })); setResult(null); setTradePage(0); setError('')
    notify(`${data.name} · ${money(data.bars.length)}개 가격 행을 불러왔습니다.`)
  }
  async function importFile(file: File | undefined) {
    if (!file) return
    const token = ++loadingJob.current; setLoading(true); setError('')
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('CSV 파일은 20MB 이하로 선택하세요.')
      const buffer = await file.arrayBuffer(), hash = await fingerprint(buffer)
      const parsed = parseCsv(decodeCsv(buffer), { name: name.trim() || file.name, symbol, source, adjustment, sha256: hash })
      if (loadingJob.current === token) applyData(parsed)
    } catch (e) { if (loadingJob.current === token) setError(e instanceof Error ? e.message : 'CSV를 읽지 못했습니다.') }
    finally { if (loadingJob.current === token) setLoading(false) }
  }
  async function loadCache() {
    const token = ++loadingJob.current; setLoading(true); setError('')
    try {
      const response = await fetch('/local-data/manifest.json', { cache: 'no-store' })
      if (!response.ok) throw new Error('cache')
      const meta = await response.json()
      if (typeof meta.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(meta.sha256) || meta.symbol !== '229200' || meta.adjustment !== 'unadjusted' || typeof meta.name !== 'string' || typeof meta.source !== 'string') throw new Error('metadata')
      const csv = await fetch('/local-data/229200.csv', { cache: 'no-store' })
      if (!csv.ok) throw new Error('cache')
      const buffer = await csv.arrayBuffer(), hash = await fingerprint(buffer)
      if (hash !== meta.sha256) throw new Error('hash')
      const data = parseCsv(decodeCsv(buffer), { name: meta.name, symbol: meta.symbol, source: meta.source, adjustment: meta.adjustment, sha256: hash })
      if (data.bars.length !== meta.rows || data.bars[0].date !== meta.first || data.bars.at(-1)!.date !== meta.last) throw new Error('metadata')
      if (Array.isArray(meta.warnings)) data.warnings.push(...meta.warnings.filter((v: unknown): v is string => typeof v === 'string'))
      if (loadingJob.current === token) applyData(data)
    } catch { if (loadingJob.current === token) setError('이 PC의 보관 CSV가 없거나 원본 해시와 다릅니다. 자동으로 다른 데이터로 대체하지 않았습니다. 과거 가격 CSV를 직접 불러오세요.') }
    finally { if (loadingJob.current === token) setLoading(false) }
  }
  async function loadExample() {
    const token = ++loadingJob.current; setLoading(true); setError('')
    try {
      const csv = exampleCsv(), buffer = new TextEncoder().encode(csv).buffer
      const data = parseCsv(csv, { name: '가상 가격 예제', symbol: 'DEMO', source: '결정적 합성 시계열 · 실제 시장 데이터 아님', adjustment: 'unknown', sha256: await fingerprint(buffer), kind: 'synthetic' })
      if (loadingJob.current === token) applyData(data)
    } catch (e) { setError((e as Error).message) }
    finally { if (loadingJob.current === token) setLoading(false) }
  }
  function run() {
    if (!dataset) return
    cancel(); setError(''); setRunning(true)
    const id = ++job.current
    try {
      const instance = new Worker(new URL('./backtest.worker.ts', import.meta.url), { type: 'module' }); worker.current = instance
      instance.onmessage = ({ data }: MessageEvent<RunResponse>) => {
        if (data.id !== job.current) return
        instance.terminate(); worker.current = null; setRunning(false)
        if ('error' in data) setError(data.error)
        else { setResult(data.result); setTradePage(0); notify('백테스트 계산을 완료했습니다.') }
      }
      instance.onerror = e => { e.preventDefault(); if (job.current === id) { instance.terminate(); worker.current = null; setRunning(false); setError('계산 작업을 시작하지 못했습니다. 로컬 서버에서 페이지를 새로고침해 다시 실행하세요.') } }
      instance.postMessage({ id, dataset, config: { ...config } })
    } catch (e) { setRunning(false); setError((e as Error).message) }
  }
  const update = <K extends keyof Config>(key: K, value: Config[K]) => setConfig(c => ({ ...c, [key]: value }))
  const selectedStrategy = strategies.find(s => s.id === config.strategy)!
  const points = result ? chartRows(result.daily) : []
  const stale = result && JSON.stringify(result.config) !== JSON.stringify(config)
  const lastPage = result ? Math.max(0, Math.ceil(result.fills.length / 10) - 1) : 0
  function exportDaily() {
    if (!result) return
    downloadCsv('backtest-equity.csv', [['date', 'equity', 'buy_hold_equity', 'cash', 'shares', 'drawdown_pct'], ...result.daily.map(p => [p.date, p.equity, p.benchmark, p.cash, p.shares, p.drawdown])])
  }
  function exportFills() {
    if (!result) return
    downloadCsv('backtest-fills.csv', [['date', 'signal_date', 'side', 'quantity', 'raw_price', 'fill_price', 'notional', 'fee', 'sell_tax', 'slippage_cost', 'cash_after', 'shares_after', 'realized_pnl'], ...result.fills.map(f => [f.date, f.signalDate, f.side, f.quantity, f.rawPrice, f.price, f.notional, f.fee, f.tax, f.slippage, f.cashAfter, f.sharesAfter, f.realizedPnl ?? ''])])
  }
  return <div className="historical-backtest">
    <div className="backtest-banner"><span className="strategy-symbol"><Icon name="flask" size={25}/></span><div><h2>과거 가격으로 전략을 검증하세요.</h2><p>CSV 데이터와 매매 비용을 연결하고, 모든 체결의 근거를 확인합니다.</p></div><Badge>오프라인 분석</Badge></div>
    <Panel title="1. 가격 데이터 불러오기" subtitle="CSV는 이 브라우저에서 처리합니다. 업로드한 가격과 결과를 외부 서버에 전송하지 않습니다.">
      <div className="data-actions"><button className="button primary" disabled={loading || running} onClick={loadCache}>이 PC 보관 시세 · 229200</button><button className="button" disabled={loading || running} onClick={loadExample}>가상 예제로 연습</button><button className="text-button" onClick={() => downloadText('price-template-synthetic.csv', exampleCsv(), 'text/csv;charset=utf-8')}>CSV 형식 예제 내려받기 <Icon name="download" size={14}/></button></div>
      <details className="csv-import" open={!dataset}><summary>다른 종목의 CSV 불러오기</summary><div className="import-fields"><label>종목 이름<input value={name} maxLength={80} onChange={e => setName(e.target.value)}/></label><label>종목코드<input value={symbol} maxLength={24} onChange={e => setSymbol(e.target.value)} placeholder="229200"/></label><label>원 데이터 출처<input value={source} maxLength={180} onChange={e => setSource(e.target.value)} placeholder="예: KRX에서 직접 내려받은 CSV"/></label><label>가격 조정 기준<select value={adjustment} onChange={e => setAdjustment(e.target.value as Adjustment)}><option value="unknown">조정 여부 미확인</option><option value="unadjusted">원주가 · 수정 미적용</option><option value="adjusted">OHLC 동일 기준 수정주가</option></select></label></div><label className="file-picker">과거 가격 CSV 선택<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" disabled={loading || running} onChange={e => { void importFile(e.target.files?.[0]); e.target.value = '' }}/></label><p>필수: date·close / 시가 체결: open 추가. 한글 일자·종가·시가도 지원합니다. UTF-8·CP949, 최대 20MB·10만 행. 위 설명은 다음에 불러올 파일에 적용됩니다.</p></details>
      {loading && <p className="data-loading" role="status">가격 데이터 검증 중…</p>}
      {dataset && <div className="dataset-summary"><div><Badge kind={dataset.kind === 'synthetic' ? 'amber' : 'green'}>{dataset.kind === 'synthetic' ? '가상 데이터' : '보관 / 업로드 가격'}</Badge><strong>{dataset.name}</strong><span>{dataset.symbol} · {money(dataset.bars.length)}행 · {dataset.bars[0].date} — {dataset.bars.at(-1)!.date}</span></div><p>{dataset.source} · {adjustmentLabels[dataset.adjustment]}</p><details><summary>데이터 검증 정보</summary><code>SHA-256 {dataset.sha256}</code><p>중복·날짜·유한 가격·OHLC 범위·단일 종목 검사를 통과했습니다. 거래소 원본의 정확성과 모든 휴장일을 보증하는 검증은 아닙니다.</p>{dataset.warnings.map((w, i) => <p key={i} className="data-warning">{w}</p>)}</details></div>}
    </Panel>
    {error && <div className="backtest-error" role="alert"><Icon name="info" size={18}/><span>{error}</span></div>}
    <div className="history-layout">
      <Panel title="2. 매매 조건" subtitle="신호는 체결일 이전의 가격만 사용합니다."><form className="history-form" onSubmit={e => { e.preventDefault(); run() }}><fieldset disabled={running || loading}>
        <label>백테스트 전략<select value={config.strategy} onChange={e => update('strategy', e.target.value as Config['strategy'])}>{strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><p className="strategy-rule">{selectedStrategy.description}</p>
        <div className="form-pair"><label>분석 시작일<input type="date" required min={dataset?.bars[0].date} max={dataset?.bars.at(-1)!.date} value={config.start} onChange={e => update('start', e.target.value)}/></label><label>분석 종료일<input type="date" required min={dataset?.bars[0].date} max={dataset?.bars.at(-1)!.date} value={config.end} onChange={e => update('end', e.target.value)}/></label></div>
        <label>체결 기준<select value={config.execution} onChange={e => update('execution', e.target.value as Config['execution'])}><option value="next-open" disabled={!!dataset && !dataset.bars.every(b => b.open !== undefined)}>다음 거래일 시가</option><option value="next-close">다음 거래일 종가</option></select></label>
        <div className="form-pair"><label>초기 자금 (원)<input type="number" required min="100000" max="1000000000" step="100000" value={config.capital} onChange={e => update('capital', Number(e.target.value))}/></label><label>진입 비중 (%)<input type="number" required min="1" max="100" value={config.allocation} onChange={e => update('allocation', Number(e.target.value))}/></label></div>
        <div className="form-pair"><label>편도 수수료 (%)<input type="number" required min="0" max="2" step="0.001" value={config.fee} onChange={e => update('fee', Number(e.target.value))}/></label><label>편도 슬리피지 (%)<input type="number" required min="0" max="2" step="0.001" value={config.slippage} onChange={e => update('slippage', Number(e.target.value))}/></label></div>
        <label>매도세 (%)<input type="number" required min="0" max="2" step="0.001" value={config.sellTax} onChange={e => update('sellTax', Number(e.target.value))}/><small>종목과 적용 시기의 세율을 직접 입력합니다. 기본값 0%는 세금 면제 판정이 아닙니다.</small></label>
        {config.strategy === 'triple' ? <label>삼중 모멘텀 기준선 (%)<input type="number" required min="-50" max="50" step="0.1" value={config.threshold} onChange={e => update('threshold', Number(e.target.value))}/></label> : <div className="form-pair">{config.strategy === 'sma' && <label>단기 평균 (거래일)<input type="number" required min="1" max="249" value={config.fast} onChange={e => update('fast', Number(e.target.value))}/></label>}<label>{config.strategy === 'breakout' ? '이전 고가 기간 (거래일)' : '장기 평균 (거래일)'}<input type="number" required min="2" max="250" value={config.slow} onChange={e => update('slow', Number(e.target.value))}/></label></div>}
        <button className="button primary" type="submit" disabled={!dataset}><Icon name="play" size={16}/>백테스트 계산</button>
      </fieldset>{running && <button className="button" type="button" onClick={cancel}>계산 중단</button>}<p className="form-note subtle">원 단위 가격·정수 주 수량. 현금 이자와 배당·분배금은 제외하며 마지막 보유분은 종가로 평가합니다. 관제 모의계좌의 장부와 독립적으로 계산합니다.</p></form></Panel>
      <div className="history-results"><Panel title="3. 백테스트 결과" subtitle={result ? `${result.dataset.symbol} · ${result.daily[0].date} — ${result.daily.at(-1)!.date} · ${strategies.find(s => s.id === result.config.strategy)?.name}` : '데이터와 조건을 확인한 뒤 계산을 실행하세요.'}>
        {running && <p className="data-loading" role="status">별도 계산 작업에서 백테스트를 실행하고 있습니다…</p>}
        {!result ? <div className="history-empty"><Icon name="chart" size={44}/><h3>체결 근거까지 확인하는 백테스트</h3><p>가격 자료를 불러오면 분석 기간이 자동으로 설정됩니다.</p><p>자산곡선·낙폭·비용·체결 원장이 여기에 표시됩니다.</p></div> : <>
          {stale && <div className="stale-result" role="status">조건이 변경되었습니다. 아래는 이전 실행 결과입니다. 새 조건은 다시 계산하세요.</div>}
          <div className="history-metrics"><div><span>비용 반영 수익률</span><strong className={tone(result.totalReturn)}>{pct(result.totalReturn)}</strong></div><div><span>매수 후 보유 대비</span><strong className={tone(result.totalReturn - result.benchmarkReturn)}>{pct(result.totalReturn - result.benchmarkReturn)}p</strong></div><div><span>최대 낙폭 · 종가 기준</span><strong className="negative">-{result.maxDrawdown.toFixed(2)}%</strong></div><div><span>연복리 수익률 · CAGR</span><strong>{result.cagr === null ? '—' : Math.abs(result.cagr) > 1000000 ? '>1,000,000%' : pct(result.cagr)}</strong></div></div>
          <div className="chart-controls"><div className="tabs" role="tablist" aria-label="백테스트 차트">{['자산곡선', '낙폭'].map(t => <button key={t} role="tab" aria-selected={chart === t} className={chart === t ? 'selected' : ''} onClick={() => setChart(t)}>{t}</button>)}</div><Badge kind={result.dataset.kind === 'synthetic' ? 'amber' : 'green'}>{result.dataset.kind === 'synthetic' ? '가상 예제 결과' : 'CSV 가격 기반 결과'}</Badge></div>
          <LineChart values={points.map(p => chart === '자산곡선' ? p.equity : -p.drawdown)} benchmark={chart === '자산곡선' ? points.map(p => p.benchmark) : undefined} labels={points.map(p => p.date.replaceAll('-', '.'))} percent={chart !== '자산곡선'}/>
          {chart === '자산곡선' && <div className="chart-legend"><span><i className="legend-dot teal"/>선택 전략</span><span><i className="legend-line"/>동일 종목 매수 후 보유 · 비용·비중 동일</span></div>}
          <div className="history-total"><span>최종 평가자산</span><strong>₩ {money(result.finalEquity)}</strong></div>
          <dl className="result-details"><div><dt>체결 / 청산 거래</dt><dd>{result.fills.length}건 / {result.closedTrades}회</dd></div><div><dt>청산 거래 승률</dt><dd>{result.winRate === null ? '—' : `${result.winRate.toFixed(1)}%`}</dd></div><div><dt>총이익 / 총손실</dt><dd>{result.profitFactor === null ? '—' : result.profitFactor.toFixed(2)}</dd></div><div><dt>최종 현금 / 보유 수량</dt><dd>{money(result.finalCash)}원 / {money(result.finalShares)}주</dd></div><div><dt>전략 수수료 / 매도세</dt><dd>{money(result.fees)}원 / {money(result.taxes)}원</dd></div><div><dt>전략 슬리피지 비용</dt><dd>{money(result.slippageCost)}원</dd></div></dl>
          <div className="result-downloads"><button className="button small" onClick={exportDaily}><Icon name="download" size={14}/>자산곡선 CSV</button><button className="button small" onClick={exportFills}><Icon name="download" size={14}/>체결 원장 CSV</button><button className="button small" onClick={() => downloadText('backtest-result.json', JSON.stringify({ schemaVersion: 1, engineVersion: '0.2.0', ...result }, null, 2), 'application/json')}>설정·결과 JSON</button></div>
          <details className="result-assumptions"><summary>이번 결과의 데이터·계산 기준</summary><p>{result.dataset.name} · {result.dataset.source}</p><p>가격 조정: {adjustmentLabels[result.dataset.adjustment]} / 체결: {result.config.execution === 'next-open' ? '다음 거래일 시가' : '다음 거래일 종가'} / 진입 비중 {result.config.allocation}%</p><p>편도 수수료 {result.config.fee}% · 편도 슬리피지 {result.config.slippage}% · 매도세 {result.config.sellTax}%</p><p>데이터 {result.dataset.rows}행, 시작일 앞 보관 데이터 {result.warmupRows}행. 같은 종목·같은 가격 기준으로 신호와 체결을 계산합니다. 매수 후 보유도 시작일에 같은 비중과 매수 비용을 적용하고 마지막에는 평가합니다.</p><p>승률은 비용을 뺀 청산 거래 기준입니다. 손실 청산이 없으면 Profit factor를 수치로 표시하지 않습니다. 짧은 기간의 CAGR은 과장될 수 있습니다.</p><code>SHA-256 {result.dataset.sha256}</code>{result.warnings.map((w, i) => <p className="data-warning" key={i}>{w}</p>)}</details>
        </>}
      </Panel>
      {result && <Panel title="체결 원장" subtitle="전일 신호와 다음 거래일 체결을 구분해 기록합니다." action={<span className="subtle">{result.fills.length}건</span>}><div className="table-scroll"><table className="fills-table"><thead><tr><th>체결일 / 신호일</th><th>구분</th><th className="number">수량</th><th className="number">체결가 / 기준가</th><th className="number">수수료 / 매도세</th><th className="number">실현손익</th></tr></thead><tbody>{result.fills.slice(tradePage * 10, tradePage * 10 + 10).map((f, i) => <tr key={`${f.date}-${i}`}><td>{f.date}<small>신호 {f.signalDate}</small></td><td className={f.side === 'buy' ? 'positive' : 'negative'}>{f.side === 'buy' ? '매수' : '매도'}</td><td className="number">{money(f.quantity)}주</td><td className="number">{money(f.price)}<small>기준 {money(f.rawPrice)}</small></td><td className="number">{money(f.fee)}<small>세금 {money(f.tax)}</small></td><td className={`number ${f.realizedPnl === null ? '' : tone(f.realizedPnl)}`}>{f.realizedPnl === null ? '—' : `${f.realizedPnl >= 0 ? '+' : ''}${money(f.realizedPnl)}`}</td></tr>)}</tbody></table>{!result.fills.length && <div className="empty">조건을 만족한 체결이 없습니다. 수익률 0%도 유효한 결과입니다.</div>}</div><div className="fills-pagination"><span>화면은 원 단위 반올림 · CSV/JSON은 계산값 보존</span><button className="button small" disabled={tradePage === 0} onClick={() => setTradePage(p => p - 1)}>이전</button><span>{tradePage + 1} / {lastPage + 1}</span><button className="button small" disabled={tradePage === lastPage} onClick={() => setTradePage(p => p + 1)}>다음</button></div></Panel>}
      </div>
    </div>
    <div className="inline-note"><Icon name="info" size={16}/>이 분석은 과거 가격과 입력한 비용에 따른 시뮬레이션입니다. 거래소 휴장일 완전성·기업행사·분배금·체결 가능 물량을 검증한 총수익 백테스트는 아닙니다.</div>
  </div>
}
