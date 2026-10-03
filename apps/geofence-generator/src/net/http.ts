/** Fetch JSON, turning network and HTTP failures into errors that say what to do. */
export async function fetchJson(
  service: string,
  url: string,
  init: RequestInit,
  statusHint: (status: number) => string | null
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch {
    throw new Error(`Could not reach ${service}. Check your internet connection and try again.`)
  }
  if (!response.ok) {
    const hint = statusHint(response.status)
    throw new Error(`${service} answered with HTTP ${String(response.status)}. ${hint ?? 'Try again in a moment.'}`)
  }
  try {
    return await response.json()
  } catch {
    throw new Error(`${service} returned a response that is not valid JSON. Try again in a moment.`)
  }
}
