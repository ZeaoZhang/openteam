const DEFAULT_DISPATCH_TIMEOUT_MS = 1500

export type EditorWriteStrategy = 'native' | 'paste' | 'dom'

let lastWriteStrategy: EditorWriteStrategy | undefined
let lastWriteDiagnostics = ''

/** Which pipeline the previous setContentEditableText() call used; useful when a send fails later. */
export function getLastEditorWriteStrategy(): EditorWriteStrategy | undefined {
  return lastWriteStrategy
}

/** Compact trail of why the native/paste pipelines were skipped; surfaced in send error messages. */
export function getLastEditorWriteDiagnostics(): string {
  return lastWriteDiagnostics
}

function noteWriteDiagnostic(step: string): void {
  lastWriteDiagnostics = step
}

export function setContentEditableText(
  editor: HTMLElement,
  content: string,
  options: { allowPaste?: boolean } = {},
): void {
  if (writeWithNativeEditingPipeline(editor, content)) {
    lastWriteStrategy = 'native'
    return
  }
  if (options.allowPaste === false) {
    writeWithDomMutation(editor, content)
    lastWriteStrategy = 'dom'
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
    if (!isFocusedInside(editor)) {
      noteWriteDiagnostic('paste:not-focused')
      return false
    }
    if (editorHoldsText(editor, content)) return true

    clearEditorSelection(editor)
    const data = new DataTransfer()
    data.setData('text/plain', content)
    data.setData('text/html', `<p>${escapeHtml(content)}</p>`)
    editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    return editorHoldsText(editor, content)
  } catch {
    return false
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Sites normalize whitespace inside their editors (list markers become single spaces, trailing
 * newlines vanish). Compare on collapsed whitespace so a faithful long prompt is not treated as a
 * failed write.
 */
export function editorHoldsText(editor: HTMLElement, content: string): boolean {
  const collapse = (value: string) => value.replace(/\s+/g, '')
  const target = collapse(content)
  const actual = collapse(readEditorText(editor))
  if (actual === target) return true
  return editorKeptPromptStart(actual, target)
}

/**
 * Some editors rebuild markdown as they accept it (Kimi re-renders list markers and code fences), so
 * the readback never matches character for character even though the whole prompt landed. Treat the
 * write as accepted when the editor kept the opening of the prompt and grew to a comparable size;
 * the dispatch check afterwards still verifies the site actually sent something.
 */
function editorKeptPromptStart(actual: string, target: string): boolean {
  if (!target || !actual) return false
  const probeLength = Math.min(40, target.length)
  if (!actual.includes(target.slice(0, probeLength))) return false
  return actual.length >= Math.min(target.length, 400) * 0.5
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
  if (!editor.isContentEditable) {
    noteWriteDiagnostic('native:not-editable')
    return false
  }
  if (typeof document.execCommand !== 'function') {
    noteWriteDiagnostic('native:no-execCommand')
    return false
  }

  try {
    editor.focus()
    if (!isFocusedInside(editor)) {
      noteWriteDiagnostic('native:not-focused')
      return false
    }

    if (!clearEditorSelection(editor)) noteWriteDiagnostic('native:clear-partial')
    if (!document.execCommand('insertText', false, content)) {
      noteWriteDiagnostic('native:insertText-rejected')
      return false
    }
    if (editorHoldsText(editor, content)) return true

    // Some editors insert the text but keep the placeholder paragraph; retry once from clean state.
    clearEditorSelection(editor)
    if (document.execCommand('insertText', false, content) && editorHoldsText(editor, content)) return true
    noteWriteDiagnostic(`native:mismatch(${JSON.stringify(readEditorText(editor).slice(0, 20))})`)
    return false
  } catch (error) {
    noteWriteDiagnostic(`native:error(${error instanceof Error ? error.message : String(error)})`)
    return false
  }
}

/**
 * Some chat pages render their composer before the editor library finishes booting, so the first
 * write can be wiped by the site's first render. Retry a few times until the editor keeps the text.
 */
export async function writeEditorTextWithRetry(
  editor: HTMLElement,
  content: string,
  options: { attempts?: number; delayMs?: number; stabilityDelayMs?: number; allowPaste?: boolean } = {},
): Promise<boolean> {
  const attempts = options.attempts ?? 4
  const delayMs = options.delayMs ?? 600
  const stabilityDelayMs = options.stabilityDelayMs ?? 400

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    setContentEditableText(editor, content, { allowPaste: options.allowPaste })
    if (!editorHoldsText(editor, content)) {
      if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs))
      continue
    }
    // A just-mounted composer can accept the text and then drop it during the site's first render,
    // so confirm the text survives a beat before declaring the write successful.
    await new Promise(resolve => setTimeout(resolve, stabilityDelayMs))
    if (editorHoldsText(editor, content)) return true
    if (attempt < attempts - 1) await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  return editorHoldsText(editor, content)
}

/**
 * Empty the editor through the site's own editing pipeline. Large drafts (Lexical keeps its own
 * document model) can survive a single `delete`, so retry with select-all and report whether the
 * editor really ended up empty.
 */
export function clearEditorContent(editor: HTMLElement): boolean {
  if (isEditorEmpty(editor)) return true
  for (let attempt = 0; attempt < 3; attempt += 1) {
    clearEditorSelection(editor)
    if (isEditorEmpty(editor)) return true
    if (typeof document.execCommand !== 'function') break
    if (!document.execCommand('selectAll', false)) continue
    document.execCommand('delete', false)
    if (isEditorEmpty(editor)) return true
  }
  return isEditorEmpty(editor)
}

function isEditorEmpty(editor: HTMLElement): boolean {
  return readEditorText(editor).replace(/\s+/g, '').length === 0
}

function clearEditorSelection(editor: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection) return false

  const range = document.createRange()
  range.selectNodeContents(editor)
  selection.removeAllRanges()
  selection.addRange(range)
  if (typeof document.execCommand === 'function') document.execCommand('delete', false)
  return isEditorEmpty(editor)
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

/**
 * Adapters use this to explain a failed write: a composer that survived the clear usually means the
 * site restored an unsent draft, which a script cannot remove without trusted input.
 */
export function describeEditorWriteFailure(editor: HTMLElement): string {
  const leftover = readEditorText(editor).replace(/\s+/g, ' ').trim()
  if (!leftover) return ''
  return `；输入框里残留了 ${leftover.length} 个字符的未发送内容，请在该角色页面里手动清空输入框后重试`
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
