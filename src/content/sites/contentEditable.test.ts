// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchEnterKey, editorHoldsText, getLastEditorWriteStrategy, readEditorText, setContentEditableText, submitEditorWithKeyboard, waitForPromptDispatch } from './contentEditable'

function createEditor(): HTMLElement {
  document.body.innerHTML = '<div contenteditable="true" role="textbox"><p><br></p></div>'
  return document.querySelector<HTMLElement>('[contenteditable="true"]')!
}

function stubActiveElement(editor: HTMLElement): void {
  Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
  Object.defineProperty(document, 'activeElement', { configurable: true, get: () => editor })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'execCommand')
})

describe('contentEditable prompt writing', () => {
  it('writes through the browser editing pipeline so rich text editors see the state change', () => {
    const editor = createEditor()
    stubActiveElement(editor)
    const execCommand = vi.fn((command: string, _showUi?: boolean, value?: string) => {
      if (command === 'delete') editor.replaceChildren()
      if (command === 'insertText') editor.textContent = value ?? ''
      return true
    })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    setContentEditableText(editor, '你好 ProseMirror')

    expect(editor.textContent).toBe('你好 ProseMirror')
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '你好 ProseMirror')
  })

  it('accepts a write the site re-rendered as long as the prompt opening survived', () => {
    const editor = createEditor()
    const prompt = '请以「资料研究员」身份回复。你可以参考、补充或反驳其他成员观点。' + '正文'.repeat(200)
    // Kimi rebuilds markdown while accepting the text, so the readback never matches byte for byte.
    editor.textContent = prompt.replace(/身份/g, '身份') + '\n\n- 列表项被站点重排'

    expect(editorHoldsText(editor, prompt)).toBe(true)
    expect(editorHoldsText(editor, '完全不同的另一段提示词')).toBe(false)
  })

  it('falls back to a DOM write when the editing pipeline is unavailable', () => {
    const editor = createEditor()
    stubActiveElement(editor)
    Reflect.deleteProperty(document, 'execCommand')
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)

    setContentEditableText(editor, 'fallback text')

    expect(editor.textContent).toBe('fallback text')
    expect(inputListener).toHaveBeenCalledTimes(1)
  })

  it('uses a synthetic paste when the editing pipeline is unavailable', () => {
    const editor = createEditor()
    stubActiveElement(editor)
    Reflect.deleteProperty(document, 'execCommand')

    class FakeDataTransfer {
      private readonly data = new Map<string, string>()
      setData(type: string, value: string): void {
        this.data.set(type, value)
      }
      getData(type: string): string {
        return this.data.get(type) ?? ''
      }
    }
    class FakeClipboardEvent extends Event {
      readonly clipboardData: FakeDataTransfer
      constructor(type: string, init: { clipboardData: FakeDataTransfer }) {
        super(type, { bubbles: true, cancelable: true })
        this.clipboardData = init.clipboardData
      }
    }
    vi.stubGlobal('DataTransfer', FakeDataTransfer)
    vi.stubGlobal('ClipboardEvent', FakeClipboardEvent)

    let pasted = ''
    editor.addEventListener('paste', event => {
      pasted = (event as unknown as { clipboardData: FakeDataTransfer }).clipboardData.getData('text/plain')
      // Emulates a rich text editor applying the pasted text to its own document model.
      editor.textContent = pasted
    })

    setContentEditableText(editor, 'pasted prompt')

    expect(pasted).toBe('pasted prompt')
    expect(editor.textContent).toBe('pasted prompt')
    expect(getLastEditorWriteStrategy()).toBe('paste')
  })

  it('reads textarea values so form based composers can be verified', () => {
    document.body.innerHTML = '<textarea>hello textarea</textarea>'
    const textarea = document.querySelector('textarea')!

    expect(readEditorText(textarea)).toBe('hello textarea')
  })

  it('detects a composer that the site cleared after sending', async () => {
    const editor = createEditor()
    setContentEditableText(editor, 'prompt in flight')

    const dispatched = waitForPromptDispatch({ editor, timeoutMs: 600 })
    window.setTimeout(() => editor.replaceChildren(), 120)

    await expect(dispatched).resolves.toBe(true)
  })

  it('resolves false when the composer keeps the draft', async () => {
    const editor = createEditor()
    setContentEditableText(editor, 'stuck draft')

    await expect(waitForPromptDispatch({ editor, timeoutMs: 250 })).resolves.toBe(false)
  })

  it('dispatches Enter with and without the meta modifier', () => {
    const editor = createEditor()
    const keys: string[] = []
    editor.addEventListener('keydown', event => keys.push(`${event.key}:${event.metaKey}`))

    dispatchEnterKey(editor)
    submitEditorWithKeyboard(editor)

    expect(keys).toEqual(['Enter:false', 'Enter:false', 'Enter:true'])
  })
})
