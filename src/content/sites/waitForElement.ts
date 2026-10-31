export function querySelectorFirst(selectors: string): HTMLElement | null {
  let fallback: HTMLElement | null = null

  for (const selector of selectors.split(',').map(item => item.trim())) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (isElementVisible(element)) return element
      fallback ??= element
    }
  }

  return fallback
}

export function querySelectorFirstMatching(selectors: string, predicate: (element: HTMLElement) => boolean): HTMLElement | null {
  for (const selector of selectors.split(',').map(item => item.trim())) {
    const elements = [...document.querySelectorAll<HTMLElement>(selector)]
    const match = elements.find(predicate)
    if (match) return match
  }

  return null
}

export function waitForElement(selectors: string, timeoutMs: number): Promise<HTMLElement> {
  const immediate = querySelectorFirst(selectors)
  if (immediate) return Promise.resolve(immediate)

  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const element = querySelectorFirst(selectors)
      if (element) {
        window.clearInterval(timer)
        resolve(element)
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer)
        reject(new Error(`Element not found: ${selectors}`))
      }
    }, 250)
  })
}

export function waitForClickableButton(selectors: string, timeoutMs: number, errorMessage: string): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const button = querySelectorFirstMatching(selectors, isClickableButton)
      if (button) {
        window.clearInterval(timer)
        resolve(button)
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer)
        reject(new Error(errorMessage))
      }
    }, 250)
  })
}

export function isClickableButton(element: HTMLElement): boolean {
  if (!(element instanceof HTMLButtonElement)) return true
  return !element.disabled && element.getAttribute('aria-disabled') !== 'true'
}

/**
 * Sites keep hidden/duplicate composers around (autosize textareas, mobile and desktop variants,
 * collapsed panels). Preferring visible nodes avoids filling a detached editor that the site never
 * sends from.
 */
export function isElementVisible(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.closest('[hidden], [aria-hidden="true"]')) return false

  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false

  // jsdom has no layout, so fall back to the inline/computed styles of the ancestors.
  if (/\bjsdom\b/i.test(window.navigator.userAgent)) return !hasHiddenAncestor(element)

  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function hasHiddenAncestor(element: Element): boolean {
  for (let node: Element | null = element.parentElement; node; node = node.parentElement) {
    if (node.hasAttribute('hidden') || node.getAttribute('aria-hidden') === 'true') return true
    if (node === document.body) break

    const style = window.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return true
  }

  return false
}
