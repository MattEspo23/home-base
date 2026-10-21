import type { HomeBaseStatus, InstanceModule } from './types.ts'

function meta(name: string): string {
  const element = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  return element?.content ?? ''
}

// The launch nonce changes every time the dashboard starts. It is read from
// the page and sent as a header, never stored. The sign-in cookie is HttpOnly:
// this code never sees it, the browser just sends it to the same origin.
const launchNonce: string = meta('home-base-token')
export const dbName: string = meta('home-base-db')

// Why a request failed, in terms the page can explain.
export type FailureReason = 'stale-page' | 'no-session' | 'no-fetch-metadata' | 'not-running' | 'other'

export class RequestFailed extends Error {
  reason: FailureReason
  constructor(reason: FailureReason) {
    super(`Request failed: ${reason}`)
    this.reason = reason
  }
}

async function getJson<T>(path: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      headers: { 'x-home-base-token': launchNonce },
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
    })
  } catch {
    throw new RequestFailed('not-running')
  }
  if (!response.ok) {
    const text = (await response.text().catch(() => '')).trim()
    const known: FailureReason[] = ['stale-page', 'no-session', 'no-fetch-metadata']
    throw new RequestFailed(known.find((reason) => reason === text) ?? 'other')
  }
  return (await response.json()) as T
}

export const getStatus = (): Promise<HomeBaseStatus> => getJson<HomeBaseStatus>('/api/status')
export const getModules = (): Promise<{ modules: InstanceModule[] }> => getJson<{ modules: InstanceModule[] }>('/api/modules')
