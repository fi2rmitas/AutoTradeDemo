import { useId, useRef, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
export const money = (n: number) => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 }).format(n)
export const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
export const tone = (n: number) => n >= 0 ? 'positive' : 'negative'
const paths: Record<string, ReactNode> = {
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  chart: <><path d="M4 4v16h16M7 14l4-5 4 3 5-7"/></>,
  layers: <><path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/></>,
  wallet: <><rect x="3" y="5" width="18" height="15" rx="3"/><path d="M3 8h18M16 12h5v5h-5z"/><path d="M6 5V3h11v2"/></>,
  orders: <><path d="M8 3H4v18h16V3h-4M8 3h8v4H8zM8 12h8M8 16h5"/></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  pulse: <><path d="M2 12h5l3-8 4 16 3-8h5"/></>,
  flask: <><path d="M9 3h6M10 3v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M7 15h10"/></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  arrow: <><path d="m5 16 5-6 4 3 5-8M14 5h5v5"/></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  chevron: <path d="m9 5 7 7-7 7"/>,
  down: <path d="m6 9 6 6 6-6"/>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  play: <path d="m8 4 12 8-12 8V4Z"/>,
  stop: <rect x="5" y="5" width="14" height="14" rx="3"/>,
  menu: <path d="M4 6h16M4 12h16M4 18h16"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  check: <path d="m5 12 4 4L19 6"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v6l4 2"/></>,
}
export function Icon({ name, size = 20 }: { name: string; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.chart}</svg> }
export function Panel({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) { return <section className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section> }
export function Badge({ children, kind = 'green' }: { children: ReactNode; kind?: string }) { return <span className={`badge ${kind}`}><span className="badge-dot"/>{children}</span> }
export function Metric({ label, value, change, detail, icon, featured = false }: { label: string; value: string; change: string; detail: string; icon: string; featured?: boolean }) { return <div className={`metric ${featured ? 'featured' : ''}`}><div className="metric-top">{label}<Icon name={icon} size={18}/></div><strong>{value}</strong><div className="metric-bottom"><span className={change.startsWith('-') ? 'negative' : change.startsWith('+') ? 'positive' : 'neutral-change'}>{change}</span><span>{detail}</span></div><svg className="metric-decoration" viewBox="0 0 100 32"><path d="m0 28 10-5 8 4 13-10 10 3 10-9 7 4 12-9 9 3L100 0" fill="none" stroke="currentColor" strokeWidth="2"/></svg></div> }
export function LineChart({ values, benchmark, labels, percent = false, compact = false }: { values: number[]; benchmark?: number[]; labels?: string[]; percent?: boolean; compact?: boolean }) {
  const id = useId().replaceAll(':', '')
  const [hover, setHover] = useState<number | null>(null)
  const all = [...values, ...(benchmark ?? [])], min = Math.min(...all) * (percent ? 1 : 0.99), max = Math.max(...all) * (percent ? 1 : 1.01)
  const span = max - min || 1
  const x = (i: number) => 52 + i / Math.max(1, values.length - 1) * 704
  const y = (v: number) => 205 - (v - min) / span * 160
  const line = (v: number[]) => v.map((n, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(n).toFixed(1)}`).join(' ')
  const format = (v: number) => percent ? `${v.toFixed(1)}%` : `${(v / 10000).toFixed(0)}만`
  return <div className={`line-chart ${compact ? 'compact' : ''}`}><svg viewBox="0 0 800 240" role="img" aria-label={`가상 성과 차트. 시작 ${format(values[0])}, 마지막 ${format(values.at(-1)!)}`} onPointerMove={e => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.min(values.length - 1, Math.max(0, Math.round(((e.clientX - r.left) / r.width * 800 - 52) / 704 * (values.length - 1))))) }} onPointerLeave={() => setHover(null)}><defs><linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#12ad90" stopOpacity=".18"/><stop offset="100%" stopColor="#12ad90" stopOpacity="0"/></linearGradient></defs>{[0, 1, 2, 3, 4].map(i => { const v = min + span * i / 4; return <g key={i}><line x1="52" y1={y(v)} x2="756" y2={y(v)} stroke="#edf0f2" strokeDasharray="4 5"/><text x="0" y={y(v) + 4} fill="#8b95a3" fontSize="10">{format(v)}</text></g> })}<path d={`${line(values)} L756,210 L52,210 Z`} fill={`url(#${id})`}/>{benchmark && <path d={line(benchmark)} fill="none" stroke="#acb7c6" strokeWidth="2" strokeDasharray="5 5"/>}<path d={line(values)} fill="none" stroke="#12aa8c" strokeWidth="2.8" strokeLinejoin="round"/><circle cx={756} cy={y(values.at(-1)!)} r="4" fill="#12aa8c" stroke="white" strokeWidth="2"/>{[0, 1, 2, 3, 4, 5].map(n => { const i = Math.round(n * (values.length - 1) / 5); return <text key={n} x={x(i)} y="233" textAnchor="middle" fill="#8b95a3" fontSize="10">{labels?.[i] ?? `${i + 1}일`}</text> })}{hover !== null && <g><line x1={x(hover)} x2={x(hover)} y1="28" y2="210" stroke="#98b5ac" strokeDasharray="3 3"/><circle cx={x(hover)} cy={y(values[hover])} r="4" fill="#12aa8c"/><rect x={Math.min(660, Math.max(52, x(hover) - 55))} y="6" width="110" height="26" rx="6" fill="#173c35"/><text x={Math.min(660, Math.max(52, x(hover) - 55)) + 55} y="23" textAnchor="middle" fill="white" fontSize="11">{format(values[hover])}</text></g>}</svg></div>
}
export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose() }} aria-label={title}><div className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="닫기"><Icon name="close"/></button></div>{children}</dialog>
}
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv = '\uFEFF' + rows.map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })), a = document.createElement('a')
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url)
}

