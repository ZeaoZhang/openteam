const DEFAULT_DISPATCH_TIMEOUT_MS = 1500

export type EditorWriteStrategy = 'native' | 'paste' | 'dom'

let lastWriteStrategy: EditorWriteStrategy | undefined

/** Which pipeline the previous setContentEditableText() call used; useful when a send fails later. */
export function getLastEditorWriteStrategy(): EditorWriteStrategy | undefined {
  return lastWriteStrategy
}

export function setContentEditableText(editor: HTMLElement, content: string): void {
  if (writeWithNativeEditingPipeline(editor, content)) {
    lastWriteStrategy = 'native'
    return
  }
  // execCommand is unavailable (or silently ignored) in some embedded frames. A synthetic paste is
  // handled by every rich text editor (ProseMirror/tiptap/Quill) as a first class editing command, so
  // the site's document model stays in sync and its send button becomes clickable.
  if (writeWithPasteEvent(editor, content)) {
    lastWriteStrategy = 'paste'
    return
  }
  writeWithDomMutation(editor, content)
  lastWriteStrategy = 'dom'
}

function writeWithPasteEvent(editor: HTMLElement, content: string): boolean {
  if (!editor.isContentEditable) return false
  if (typeof ClipboardEvent !== 'function' || typeof DataTransfer !== 'function') return false

  try {
    editor.focus()
    if (!isFocusedInside(editor)) return false
    if (readEditorText(editor) === content.trim()) return true

    clearEditorSelection(editor)
    const data = new DataTransfer()
    data.setData('text/plain', content)
    data.setData('text/html', `<p>${escapeHtml(content)}</p>`)
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    return readEditorText(editor) === content.trim()
  } catch {
    return false
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function readEditorText(editor: HTMLElement, options: { normalizeNbsp?: boolean } = {}): string {
  const raw =
    editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
      ? editor.value
      : editor.innerText || editor.textContent || ''
  const text = options.normalizeNbsp ? raw.replace(/\u00a0/g, ' ') : raw
  return text.trim()
}

/**
 * Rich text editors (ProseMirror/tiptap based sites such as ChatGPT, Claude and Grok) keep their
 * own document model. Mutating the DOM directly leaves that model empty, so the site never enables
 * its send button and the prompt is silently lost. Going through the browser editing pipeline keeps
 * both in sync.
 */
function writeWithNativeEditingPipeline(editor: HTMLElement, content: string): boolean {
  if (!editor.isContentEditable) return false
  if (typeof document.execCommand !== 'function') return false

  try {
    editor.focus()
    if (!isFocusedInside(editor)) return false

    clearEditorSelection(editor)
    if (!document.execCommand('insertText', false, content)) return false
    if (readEditorText(editor) === content.trim()) return true

    // Some editors insert the text but keep the placeholder paragraph; retry once from clean state.
    clearEditorSelection(editor)
    return document.execCommand('insertText', false, content) && readEditorText(editor) === content.trim()
  } catch {
    return false
  }
}

function clearEditorSelection(editor: HTMLElement): void {
  const selection = window.getSelection()
  if (!selection) return

  const range = document.createRange()
  range.selectNodeContents(editor)
  selection.removeAllRanges()
  selection.addRange(range)
  if (typeof document.execCommand === 'function') document.execCommand('delete', false)
}

function isFocusedInside(editor: HTMLElement): boolean {
  const active = document.activeElement
  return active === editor || Boolean(active && editor.contains(active))
}

function writeWithDomMutation(editor: HTMLElement, content: string): void {
  editor.focus()
  editor.replaceChildren()

  const block = document.createElement('p')
  block.textContent = content
  editor.append(block)

  editor.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, inputType: 'insertText', data: content }))
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }))
  editor.dispatchEvent(new Event('change', { bubbles: true }))
}

export function dispatchEnterKey(editor: HTMLElement, options: { metaKey?: boolean } = {}): boolean {
  editor.focus()

  const eventOptions = {
    bubbles: true,
    cancelable: true,
    composed: true,
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    metaKey: options.metaKey ?? false,
  }

  editor.dispatchEvent(new KeyboardEvent('keydown', eventOptions))
  editor.dispatchEvent(new KeyboardEvent('keypress', eventOptions))
  editor.dispatchEvent(new KeyboardEvent('keyup', eventOptions))
  return true
}

/** Submits the draft with the keyboard. Sites bind Enter (or Cmd+Enter) to send, so send both. */
export function submitEditorWithKeyboard(editor: HTMLElement): boolean {
  dispatchEnterKey(editor)
  dispatchEnterKey(editor, { metaKey: true })
  return true
}

export interface PromptDispatchOptions {
  editor: HTMLElement
  /** Extra site specific signal that the prompt left the composer (generating indicator, new turn, ...). */
  isDispatched?: () => boolean
  timeoutMs?: number
}

/**
 * Resolves true once the site consumed the draft, which is the most reliable cross-site signal that
 * the prompt was actually submitted: the site's own send handler clears the composer.
 */
export async function waitForPromptDispatch(options: PromptDispatchOptions): Promise<boolean> {
  const { editor, isDispatched, timeoutMs = DEFAULT_DISPATCH_TIMEOUT_MS } = options
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    if (!readEditorText(editor)) return true
    if (isDispatched?.()) return true
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }

  return !readEditorText(editor) || Boolean(isDispatched?.())
}
