import { getLastEditorWriteStrategy } from './contentEditable'

const DIAGNOSTICS_STORAGE_KEY = 'openteam:last-send-failure'
const MAX_SAMPLES = 8

interface StorageAreaLike {
  set(items: Record<string, unknown>): Promise<void> | void
}

interface ChromeLike {
  storage?: { local?: StorageAreaLike }
}

export interface SendFailureContext {
  /** Extra site specific facts (button samples, editor rect, ...). */
  details?: Record<string, unknown>
  editor?: Element | null
}

/**
 * Content scripts run inside the AI site iframes, where their console is effectively unreachable.
 * Storing the last failure keeps the diagnostics readable from the team page (chrome.storage.local).
 */
export function recordSendFailure(site: string, context: SendFailureContext = {}): void {
  const storage = getStorage()
  if (!storage) return

  const payload = {
    site,
    at: Date.now(),
    href: typeof location === 'undefined' ? undefined : location.href,
    readyState: typeof document === 'undefined' ? undefined : document.readyState,
    hasFocus: typeof document === 'undefined' ? undefined : document.hasFocus(),
    visibleState: typeof document === 'undefined' ? undefined : document.visibilityState,
    writeStrategy: getLastEditorWriteStrategy(),
    editor: describeEditor(context.editor),
    ...context.details,
  }

  try {
    const result = storage.set({ [DIAGNOSTICS_STORAGE_KEY]: payload })
    if (result && typeof (result as Promise<void>).catch === 'function') {
      void (result as Promise<void>).catch(() => undefined)
    }
  } catch {
    // Diagnostics must never break the send flow.
  }
}

function describeEditor(editor: Element | null | undefined): Record<string, unknown> | undefined {
  if (!editor) return undefined
  const rect = editor.getBoundingClientRect()
  return {
    tag: editor.tagName.toLowerCase(),
    textLength: (editor.textContent || '').length,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    focused: document.activeElement === editor || editor.contains(document.activeElement),
  }
}

/** Compact samples so the stored payload stays small and readable. */
export function describeSamples(elements: Iterable<Element>, limit = MAX_SAMPLES): string[] {
  const samples: string[] = []
  for (const element of elements) {
    if (samples.length >= limit) break
    const rect = element.getBoundingClientRect()
    const label =
      element.getAttribute('aria-label') ||
      element.getAttribute('data-testid') ||
      element.getAttribute('placeholder') ||
      element.getAttribute('class')?.slice(0, 40) ||
      ''
    samples.push(
      `<${element.tagName.toLowerCase()} ${label} ${Math.round(rect.width)}x${Math.round(rect.height)}${element.getAttribute('aria-disabled') === 'true' ? ' disabled' : ''}>`,
    )
  }
  return samples
}

function getStorage(): StorageAreaLike | undefined {
  const globalScope = globalThis as { chrome?: ChromeLike }
  return globalScope.chrome?.storage?.local
}
