import { runBacktest } from './engine'
import type { Config, Dataset, Result } from './types'
export interface RunRequest { id: number; config: Config; dataset: Dataset }
export type RunResponse = { id: number; result: Result } | { id: number; error: string }
const scope = self as unknown as { onmessage: (event: MessageEvent<RunRequest>) => void; postMessage: (response: RunResponse) => void }
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ id: data.id, result: runBacktest(data.config, data.dataset) }) }
  catch (error) { scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : '백테스트 계산에 실패했습니다.' }) }
}
