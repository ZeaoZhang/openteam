// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createGrokAdapter } from './grok'

describe('Grok site adapter', () => {
  it('extracts Grok conversation ids and normalized safe urls', () => {
    const adapter = createGrokAdapter({ href: 'https://grok.com/chat/abc-123?model=grok-4' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'abc-123',
      conversationUrl: 'https://grok.com/chat/abc-123?model=grok-4',
    })
  })

  it('does not report non-Grok urls', () => {
    const adapter = createGrokAdapter({ href: 'https://grok.com.evil.example/chat/abc-123' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: undefined,
      conversationUrl: undefined,
    })
  })

  it('writes prompt text into Grok contenteditable editors', async () => {
    document.body.innerHTML = '<form><div class="ProseMirror" contenteditable="true" role="textbox"><p><br></p></div></form>'
    const editor = document.querySelector<HTMLElement>('[contenteditable="true"]')!
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)

    await createGrokAdapter().fillAndSend('你好 <grok>', false)

    expect(editor.textContent).toBe('你好 <grok>')
    expect(editor.querySelector('grok')).toBeNull()
    expect(inputListener).toHaveBeenCalledTimes(1)
  })

  it('prefers the visible query-bar ProseMirror over hidden autosize textareas', async () => {
    document.body.innerHTML = `
      <form>
        <div class="query-bar">
          <div data-testid="chat-input">
            <div class="ProseMirror" contenteditable="true" role="textbox"><p><br></p></div>
          </div>
        </div>
      </form>
      <textarea tabindex="-1" aria-hidden="true" style="visibility: hidden; height: 0px;"></textarea>
    `
    const editor = document.querySelector<HTMLElement>('[data-testid="chat-input"] .ProseMirror')!
    const hiddenTextarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-hidden="true"]')!
    const hiddenInputListener = vi.fn()
    hiddenTextarea.addEventListener('input', hiddenInputListener)

    await createGrokAdapter().fillAndSend('visible grok', false)

    expect(editor.textContent).toBe('visible grok')
    expect(hiddenTextarea.value).toBe('')
    expect(hiddenInputListener).not.toHaveBeenCalled()
  })

  it('writes prompt text into Grok textarea composers', async () => {
    document.body.innerHTML = '<form><textarea placeholder="Ask Grok anything"></textarea></form>'
    const editor = document.querySelector<HTMLTextAreaElement>('textarea')!
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)

    await createGrokAdapter().fillAndSend('hello grok', false)

    expect(editor.value).toBe('hello grok')
    expect(inputListener).toHaveBeenCalledTimes(1)
  })

  it('waits for a clickable Grok send button before clicking', async () => {
    document.body.innerHTML = `
      <form>
        <div class="query-bar">
          <div data-testid="chat-input">
            <div class="ProseMirror" contenteditable="true" role="textbox"></div>
          </div>
          <div class="composer-actions">
            <button type="button" aria-label="Attach" data-testid="attach-button"></button>
            <button type="button" aria-label="Dictation (Ctrl+D)"></button>
            <button type="submit" aria-label="Submit" data-testid="chat-submit" disabled></button>
          </div>
        </div>
      </form>
    `
    const button = document.querySelector<HTMLButtonElement>('[data-testid="chat-submit"]')!
    const clickListener = vi.fn()
    button.addEventListener('click', event => {
      event.preventDefault()
      clickListener()
    })
    window.setTimeout(() => {
      button.disabled = false
    }, 20)

    await createGrokAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(clickListener).toHaveBeenCalledTimes(1)
  })

  it('does not click Grok attach or dictation buttons when locating submit', async () => {
    document.body.innerHTML = `
      <form>
        <div class="query-bar">
          <div data-testid="chat-input">
            <div class="ProseMirror" contenteditable="true" role="textbox"></div>
          </div>
          <div class="composer-actions">
            <button type="button" aria-label="Attach" data-testid="attach-button"></button>
            <button type="button" aria-label="Model select"></button>
            <button type="button" aria-label="Dictation (Ctrl+D)"></button>
            <button type="submit" aria-label="Submit" data-testid="chat-submit"></button>
          </div>
        </div>
      </form>
    `
    const attachButton = document.querySelector<HTMLButtonElement>('[data-testid="attach-button"]')!
    const modelButton = document.querySelectorAll<HTMLButtonElement>('button')[1]!
    const dictationButton = document.querySelectorAll<HTMLButtonElement>('button')[2]!
    const submitButton = document.querySelector<HTMLButtonElement>('[data-testid="chat-submit"]')!
    const attachListener = vi.fn()
    const modelListener = vi.fn()
    const dictationListener = vi.fn()
    const submitListener = vi.fn()
    attachButton.addEventListener('click', attachListener)
    modelButton.addEventListener('click', modelListener)
    dictationButton.addEventListener('click', dictationListener)
    submitButton.addEventListener('click', event => {
      event.preventDefault()
      submitListener()
    })

    await createGrokAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(attachListener).not.toHaveBeenCalled()
    expect(modelListener).not.toHaveBeenCalled()
    expect(dictationListener).not.toHaveBeenCalled()
    expect(submitListener).toHaveBeenCalledTimes(1)
  })

  it('finds a Grok send button on the outer composer when the editor is nested in an input wrapper', async () => {
    document.body.innerHTML = `
      <form>
        <div class="message-input-shell">
          <textarea></textarea>
        </div>
        <button type="submit" aria-label="Send message" disabled>Send</button>
      </form>
    `
    const button = document.querySelector<HTMLButtonElement>('button')!
    const clickListener = vi.fn()
    button.addEventListener('click', event => {
      event.preventDefault()
      clickListener()
    })
    window.setTimeout(() => {
      button.disabled = false
    }, 20)

    await createGrokAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(clickListener).toHaveBeenCalledTimes(1)
  })

  it('clicks Grok role buttons with send labels', async () => {
    document.body.innerHTML = `
      <form>
        <textarea></textarea>
        <div role="button" aria-label="Send message"></div>
      </form>
    `
    const button = document.querySelector<HTMLElement>('[role="button"]')!
    const clickListener = vi.fn()
    button.addEventListener('click', clickListener)

    await createGrokAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(clickListener).toHaveBeenCalledTimes(1)
  })

  it('does not treat historical thought containers as active Grok generation', () => {
    document.body.innerHTML = `
      <div data-testid="assistant-message">
        <div class="thinking-container mb-3">Thought for 3s</div>
        <div class="message-bubble">GROK_VALIDATION_DONE</div>
      </div>
    `

    expect(createGrokAdapter().isGenerating()).toBe(false)
  })

  it('reads Grok assistant replies without action button text', () => {
    document.body.innerHTML = `
      <div data-testid="assistant-message">
        <p>第一段</p>
        <button aria-label="Copy">Copy</button>
        <p>第二段</p>
      </div>
    `

    expect(createGrokAdapter().getAllAssistantReplies()).toEqual(['第一段\n\n第二段'])
  })

  it('ignores Grok user bubbles when collecting assistant replies', () => {
    document.body.innerHTML = `
      <div data-testid="user-message" class="message-bubble">
        <p>这是发给 Grok 的完整群聊 prompt</p>
      </div>
      <div data-testid="assistant-message" class="message-bubble">
        <div class="thinking-container mb-3">Thought for 5s</div>
        <p>GROK_VALIDATION_DONE</p>
      </div>
    `

    expect(createGrokAdapter().getAllAssistantReplies()).toEqual(['Thought for 5s\n\nGROK_VALIDATION_DONE'])
  })

  it('converts Grok reply DOM to markdown', () => {
    document.body.innerHTML = `
      <div data-testid="assistant-message">
        <h2>方案</h2>
        <p><strong>结论</strong>：可以做</p>
        <ul><li>接入 adapter</li><li>验证登录态</li></ul>
      </div>
    `
    const response = document.querySelector('[data-testid="assistant-message"]')!

    expect(createGrokAdapter().readResponseMarkdown?.(response)).toBe('## 方案\n\n**结论**：可以做\n\n- 接入 adapter\n- 验证登录态')
  })

  it('finds the current Grok composer mounted under #chat-input', async () => {
    document.body.innerHTML = `
      <form>
        <div class="query-bar">
          <div id="chat-input">
            <div class="tiptap ProseMirror" contenteditable="true" aria-label="向 Grok 提任何问题"><p><br></p></div>
          </div>
          <button type="button" data-testid="attach-button" aria-label="附件"></button>
          <button type="submit" data-testid="chat-submit" aria-label="提交"></button>
        </div>
      </form>
    `
    const editor = document.querySelector<HTMLElement>('#chat-input .ProseMirror')!
    const attachListener = vi.fn()
    const clickListener = vi.fn()
    document.querySelector<HTMLButtonElement>('[data-testid="attach-button"]')!.addEventListener('click', attachListener)
    document.querySelector<HTMLButtonElement>('[data-testid="chat-submit"]')!.addEventListener('click', event => {
      event.preventDefault()
      clickListener()
    })

    await createGrokAdapter({ inputTimeoutMs: 250 }).fillAndSend('移动端提示词', true)

    expect(editor.textContent).toBe('移动端提示词')
    expect(clickListener).toHaveBeenCalledTimes(1)
    expect(attachListener).not.toHaveBeenCalled()
  })

  it('reports an actionable error when Grok cannot open its live connection', async () => {
    document.body.innerHTML = `
      <div class="query-bar">
        <div class="tiptap ProseMirror" contenteditable="true" aria-label="向 Grok 提任何问题"><p><br></p></div>
        <button type="submit" data-testid="chat-submit" aria-label="提交"></button>
      </div>
    `
    const editor = document.querySelector<HTMLElement>('.ProseMirror')!
    document.querySelector<HTMLButtonElement>('[data-testid="chat-submit"]')!.addEventListener('click', event => {
      event.preventDefault()
      editor.replaceChildren()
      const card = document.createElement('div')
      card.textContent = '无法开始对话 您的网络正在阻止 Grok。请尝试其他网络'
      document.body.append(card)
    })

    await expect(createGrokAdapter({ inputTimeoutMs: 250, connectionCheckTimeoutMs: 400 }).fillAndSend('hi', true)).rejects.toThrow(
      /Grok 无法建立实时连接/,
    )
  })

  it('does not treat the hidden autosize textarea as the Grok composer', async () => {
    document.body.innerHTML = `
      <div class="query-bar">
        <div id="chat-input">
          <div class="tiptap ProseMirror" contenteditable="true" aria-label="向 Grok 提任何问题"><p><br></p></div>
        </div>
      </div>
      <textarea style="display: none;"></textarea>
    `
    const hiddenTextarea = document.querySelector<HTMLTextAreaElement>('textarea')!
    const hiddenListener = vi.fn()
    hiddenTextarea.addEventListener('input', hiddenListener)

    await createGrokAdapter().fillAndSend('visible only', false)

    expect(document.querySelector<HTMLElement>('#chat-input .ProseMirror')!.textContent).toBe('visible only')
    expect(hiddenTextarea.value).toBe('')
    expect(hiddenListener).not.toHaveBeenCalled()
  })

})
