// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createQwenAdapter } from './qwen'

describe('Qwen site adapter', () => {
  it('extracts Qwen conversation ids and normalized safe urls', () => {
    const adapter = createQwenAdapter({ href: 'https://chat.qwen.ai/c/40c16172-7426-43b2-9f0e-ea136393ba86' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: '40c16172-7426-43b2-9f0e-ea136393ba86',
      conversationUrl: 'https://chat.qwen.ai/c/40c16172-7426-43b2-9f0e-ea136393ba86',
    })
  })

  it('ignores lookalike hosts', () => {
    const adapter = createQwenAdapter({ href: 'https://chat.qwen.ai.evil.example/c/abc' })

    expect(adapter.getConversationSnapshot()).toEqual({ conversationId: undefined, conversationUrl: undefined })
  })

  it('writes the prompt into the Qwen textarea and clicks the send button', async () => {
    document.body.innerHTML = `
      <div class="chat-prompt-container">
        <textarea class="message-input-textarea" placeholder="有什么我能帮你的吗？"></textarea>
        <div class="chat-prompt-send-button">
          <button class="send-button" aria-label="发送" type="submit">发送</button>
        </div>
      </div>
    `
    const editor = document.querySelector<HTMLTextAreaElement>('textarea.message-input-textarea')!
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)
    const send = document.querySelector<HTMLButtonElement>('button.send-button')!
    const clickSpy = vi.fn()
    send.addEventListener('click', clickSpy)
    const userMessage = document.createElement('div')
    userMessage.className = 'qwen-chat-message-user'

    const promise = createQwenAdapter({ inputTimeoutMs: 500 }).fillAndSend('请只回复两个字：收到')
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(inputListener).toHaveBeenCalledTimes(1)
    expect(editor.value).toBe('请只回复两个字：收到')
    document.querySelector<HTMLTextAreaElement>('textarea.message-input-textarea')!.value = ''
    document.body.append(userMessage)
    await promise
  })

  it('reads only the answer body, not the thinking status card', () => {
    document.body.innerHTML = `
      <div class="chat-messages">
        <div class="qwen-chat-message qwen-chat-message-assistant">
          <div class="chat-response-message">
            <div class="chat-response-message-right">
              <div class="chat-response-message-render-flow">
                <div class="qwen-chat-thinking-tool-status-card-wraper">已经完成思考</div>
                <div class="response-message-content t2t phase-answer"><p>收到</p></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `

    expect(createQwenAdapter().getAllAssistantReplies()).toEqual(['收到'])
  })

  it('reports generating while the stop button is present', () => {
    document.body.innerHTML = '<button class="stop-button" aria-label="停止">停止</button>'

    expect(createQwenAdapter().isGenerating()).toBe(true)
  })
})
