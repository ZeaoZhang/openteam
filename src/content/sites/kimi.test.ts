// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createKimiAdapter } from './kimi'

describe('Kimi site adapter', () => {
  it('extracts Kimi conversation ids and normalized safe urls', () => {
    const adapter = createKimiAdapter({ href: 'https://www.kimi.com/chat/p383c606-aed7-4216-905e-aa4f41bc0159?chat_enter_method=history' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'p383c606-aed7-4216-905e-aa4f41bc0159',
      conversationUrl: 'https://www.kimi.com/chat/p383c606-aed7-4216-905e-aa4f41bc0159?chat_enter_method=history',
    })
  })

  it('ignores lookalike hosts', () => {
    const adapter = createKimiAdapter({ href: 'https://www.kimi.com.evil.example/chat/abc' })

    expect(adapter.getConversationSnapshot()).toEqual({ conversationId: undefined, conversationUrl: undefined })
  })

  it('writes the prompt into the lexical composer and falls back to the send container', async () => {
    document.body.innerHTML = `
      <div class="chat-editor-input-wrap">
        <div class="chat-input-editor" contenteditable="true" role="textbox" data-lexical-editor="true"></div>
        <div class="send-button-container"><svg name="Send"></svg></div>
      </div>
    `
    const editor = document.querySelector<HTMLElement>('.chat-input-editor')!
    Object.defineProperty(editor, 'isContentEditable', { configurable: true, value: true })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn((command: string) => command === 'insertText') })
    const send = document.querySelector<HTMLElement>('.send-button-container')!
    const clickSpy = vi.fn()
    send.addEventListener('click', clickSpy)
    const userMessage = document.createElement('div')
    userMessage.className = 'chat-content-item-user'

    const promise = createKimiAdapter({ inputTimeoutMs: 500 }).fillAndSend('请只回复两个字：收到')
    // Enter is tried first; the container click only happens once the keyboard submit is ignored.
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled(), { timeout: 5000 })
    document.querySelector('.chat-input-editor')!.textContent = ''
    document.body.append(userMessage)
    await promise
  })

  it('reads assistant markdown without the tool-call thinking block', () => {
    document.body.innerHTML = `
      <div class="chat-content-item chat-content-item-assistant">
        <div class="segment segment-assistant">
          <div class="segment-container">
            <div class="segment-content">
              <div class="segment-content-box">
                <div class="toolcall-rollup">
                  <div class="markdown-container toolcall-content-text"><div class="markdown">思考中：先规划一下</div></div>
                </div>
                <div class="markdown-container"><div class="markdown"><p>Nday 漏洞指的是已披露但仍在被利用的漏洞。</p></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `

    const adapter = createKimiAdapter()

    expect(adapter.getAllAssistantReplies()).toEqual(['Nday 漏洞指的是已披露但仍在被利用的漏洞。'])
  })

  it('reports generating while a stop control is present', () => {
    document.body.innerHTML = '<button aria-label="停止生成">停止</button>'

    expect(createKimiAdapter().isGenerating()).toBe(true)
  })
})

describe('kimi paste avoidance', () => {
  it('does not convert a long prompt into a Kimi attachment via the paste event', async () => {
    document.body.innerHTML = `
      <div class="chat-input-editor" contenteditable="true" role="textbox"></div>
      <div class="send-button-container"></div>
    `
    const longPrompt = 'K'.repeat(4200)
    const adapter = createKimiAdapter({ inputTimeoutMs: 50 })
    const fill = adapter.fillAndSend(longPrompt, false)

    await new Promise(resolve => setTimeout(resolve, 0))
    const editor = document.querySelector('[contenteditable="true"]') as HTMLElement
    expect(editor.textContent).toContain(longPrompt.slice(0, 32))
    await fill
  })
})

describe('kimi capacity limits', () => {
  it('reports Kimi queue throttling instead of stalling silently', async () => {
    document.body.innerHTML = `
      <div class="chat-input-editor" contenteditable="true" role="textbox"></div>
      <div class="send-button-container"></div>
      <div id="toast">和Kimi聊天的人太多了，订阅会员可进入优先队列</div>
    `
    const adapter = createKimiAdapter({ inputTimeoutMs: 200 })
    const fill = adapter.fillAndSend('请只回复两个字：收到')
    const editor = document.querySelector('[contenteditable="true"]') as HTMLElement

    await vi.waitFor(() => expect(editor.textContent).toContain('收到'))
    editor.textContent = ''
    document.body.append(Object.assign(document.createElement('div'), { className: 'chat-content-item-user' }))

    await expect(fill).rejects.toThrow(/Kimi 当前聊天人数较多/)
  })
})

describe('kimi stale drafts', () => {
  it('refuses to append to a draft it cannot clear', async () => {
    document.body.innerHTML = `
      <div class="chat-input-editor" contenteditable="true" role="textbox">上一次没发出的提示词</div>
      <div class="send-button-container"></div>
    `
    const adapter = createKimiAdapter({ inputTimeoutMs: 200 })

    await expect(adapter.fillAndSend('请只回复两个字：收到')).rejects.toThrow(/未发送草稿/)
  })
})

