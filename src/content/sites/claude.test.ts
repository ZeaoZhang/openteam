// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createClaudeAdapter } from './claude'

describe('Claude site adapter', () => {
  it('extracts Claude conversation ids and normalized safe urls', () => {
    const adapter = createClaudeAdapter({ href: 'https://claude.ai/chat/abc-123?model=sonnet' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'abc-123',
      conversationUrl: 'https://claude.ai/chat/abc-123?model=sonnet',
    })
  })

  it('does not report non-Claude urls', () => {
    const adapter = createClaudeAdapter({ href: 'https://claude.ai.evil.example/chat/abc-123' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: undefined,
      conversationUrl: undefined,
    })
  })

  it('writes prompt text into the Claude composer', async () => {
    document.body.innerHTML = `
      <div contenteditable="true" data-testid="chat-input" role="textbox" aria-label="Write your prompt to Claude">
        <p data-placeholder="Write a message…" class="is-empty is-editor-empty"><br></p>
      </div>
    `
    const editor = document.querySelector<HTMLElement>('[data-testid="chat-input"]')!
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)

    await createClaudeAdapter().fillAndSend('你好 <claude>', false)

    expect(editor.textContent).toBe('你好 <claude>')
    expect(editor.querySelector('claude')).toBeNull()
    expect(inputListener).toHaveBeenCalledTimes(1)
  })

  it('waits for the Claude send button before clicking', async () => {
    document.body.innerHTML = `
      <div contenteditable="true" data-testid="chat-input" role="textbox"></div>
      <button type="button" aria-label="Use voice mode" disabled>Voice</button>
    `
    const sendButton = document.querySelector<HTMLButtonElement>('button')!
    const clickListener = vi.fn()
    sendButton.addEventListener('click', clickListener)
    window.setTimeout(() => {
      sendButton.disabled = false
      sendButton.setAttribute('aria-label', 'Send message')
    }, 20)

    await createClaudeAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(clickListener).toHaveBeenCalledTimes(1)
  })

  it('reads only the reply prose from the current assistant message container', () => {
    document.body.innerHTML = `
      <div data-cds="AssistantMessage" data-testid="assistant-message">
        <h3 class="sr-only" data-find-omitted="">Claude 已回复：收到</h3>
        <div data-cds="Prose" class="prose"><p>收到</p></div>
        <div data-testid="message-actions" role="toolbar"><button aria-label="复制">复制</button></div>
        <time datetime="2026-10-31T13:00:00.000Z">3分钟前</time>
      </div>
    `
    const adapter = createClaudeAdapter()
    const containers = adapter.getResponseContainers()

    expect(containers).toHaveLength(1)
    expect(adapter.readResponseText?.(containers[0])).toBe('收到')
  })

  it('reads Claude markdown replies without action button text', () => {
    document.body.innerHTML = `
      <div class="group">
        <div class="font-claude-response">
          <div class="standard-markdown">
            <p>我能做很多事情！</p>
            <ul><li>写作</li><li>编程</li></ul>
          </div>
        </div>
        <div role="group" aria-label="Message actions"><button aria-label="Copy">Copy</button></div>
      </div>
    `

    expect(createClaudeAdapter().getAllAssistantReplies()).toEqual(['我能做很多事情！\n\n写作\n编程'])
  })

  it('uses the Claude copy action to read markdown replies and restores the clipboard', async () => {
    let clipboardText = '用户原来的剪贴板'
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: vi.fn(async () => clipboardText),
        writeText: vi.fn(async (text: string) => {
          clipboardText = text
        }),
      },
    })
    document.body.innerHTML = `
      <div class="group">
        <div class="font-claude-response">
          <div class="standard-markdown">
            <p>标题</p>
            <pre><code>const answer = 42</code></pre>
          </div>
        </div>
        <div role="group" aria-label="Message actions">
          <button type="button" data-testid="action-bar-copy" aria-label="Copy">Copy</button>
        </div>
      </div>
    `
    document.querySelector<HTMLButtonElement>('[data-testid="action-bar-copy"]')?.addEventListener('click', () => {
      clipboardText = '标题\n\n```ts\nconst answer = 42\n```'
    })
    const response = document.querySelector('.font-claude-response')!

    const copied = await createClaudeAdapter({ clipboardPollMs: 5, clipboardTimeoutMs: 50 }).readResponseTextFromCopy?.(response)

    expect(copied).toBe('标题\n\n```ts\nconst answer = 42\n```')
    expect(clipboardText).toBe('用户原来的剪贴板')
  })

  it('converts Claude reply DOM to markdown when copy output is unavailable', () => {
    document.body.innerHTML = `
      <div class="font-claude-response">
        <div class="standard-markdown">
          <h2>方案</h2>
          <p><strong>结论</strong>：可以做</p>
          <ul><li>先做复制</li><li>再做兜底</li></ul>
          <pre><code>const ok = true</code></pre>
        </div>
      </div>
    `
    const response = document.querySelector('.font-claude-response')!

    expect(createClaudeAdapter().readResponseMarkdown?.(response)).toBe('## 方案\n\n**结论**：可以做\n\n- 先做复制\n- 再做兜底\n\n```\nconst ok = true\n```')
  })

  it('clicks the current Claude composer submit control', async () => {
    document.body.innerHTML = `
      <div>
        <div contenteditable="true" role="textbox" aria-label="输入您发送给 Claude 的提示词"><p><br></p></div>
        <button type="button" data-testid="chat-input-send" aria-label="发送消息"></button>
      </div>
    `
    const clickListener = vi.fn()
    document.querySelector<HTMLButtonElement>('button')!.addEventListener('click', clickListener)

    await createClaudeAdapter().fillAndSend('你好 Claude', true)

    expect(clickListener).toHaveBeenCalledTimes(1)
  })

  it('explains the Cloudflare human check instead of reporting a missing element', async () => {
    document.body.innerHTML = `
      <div id="challenge-page">
        <iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile"></iframe>
        <p>正在进行安全验证，请验证您是真人</p>
      </div>
    `

    await expect(createClaudeAdapter({ inputTimeoutMs: 80 }).fillAndSend('hello', true)).rejects.toThrow(/人机验证/)
  })

})
