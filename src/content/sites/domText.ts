const DEFAULT_BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'BR',
  'LI',
  'TR',
  'PRE',
  'BLOCKQUOTE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
])

export function extractCleanTextFromDom(node: Node, options: { skipTags: Set<string>; blockTags?: Set<string> }): string {
  const buffer: string[] = []
  const blockTags = options.blockTags ?? DEFAULT_BLOCK_TAGS

  function visit(current: Node): void {
    if (current.nodeType === Node.TEXT_NODE) {
      buffer.push(current.textContent || '')
      return
    }

    if (current.nodeType !== Node.ELEMENT_NODE) return

    const element = current as Element
    if (element.getAttribute('aria-hidden') === 'true') return
    // Screen-reader-only headings ("ChatGPT 说：", "Claude 已回复：…") are part of the message container
    // but never part of the reply text.
    if (element.hasAttribute('data-find-omitted')) return
    if (element.classList?.contains('sr-only')) return
    if (options.skipTags.has(element.tagName)) return
    if (blockTags.has(element.tagName)) buffer.push('\n')

    for (const child of element.childNodes) {
      visit(child)
    }
  }

  visit(node)

  return buffer
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function findClosestMatchingAncestor(element: Element | null, selectors: string): Element | null {
  while (element) {
    if (element.matches(selectors)) return element

    element = element.parentElement
  }

  return null
}

export function describeElement(element: Element): Record<string, unknown> {
  const htmlElement = element as HTMLElement
  return {
    tagName: element.tagName,
    id: htmlElement.id || undefined,
    className: typeof htmlElement.className === 'string' ? htmlElement.className.slice(0, 120) : undefined,
    role: element.getAttribute('role') || undefined,
    ariaLabel: element.getAttribute('aria-label') || undefined,
    ariaDisabled: element.getAttribute('aria-disabled') || undefined,
    disabled: element instanceof HTMLButtonElement ? element.disabled : undefined,
    contentEditable: htmlElement.contentEditable || undefined,
  }
}

export function buttonLabelMatches(button: Element, pattern: RegExp): boolean {
  const label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.textContent]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  return pattern.test(label)
}
