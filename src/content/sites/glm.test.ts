// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createGlmAdapter } from './glm'

describe('GLM (智谱清言) site adapter', () => {
  it('extracts conversation ids from query parameters', () => {
    const adapter = createGlmAdapter({ href: 'https://chatglm.cn/main/alltoolsdetail?lang=zh&chatId=abc-123' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'abc-123',
      conversationUrl: 'https://chatglm.cn/main/alltoolsdetail?lang=zh&chatId=abc-123',
    })
  })

  it('extracts conversation ids from the cid the composer creates', () => {
    const adapter = createGlmAdapter({ href: 'https://chatglm.cn/main/alltoolsdetail?lang=zh&cid=6ae6cd7d7aa3095d7b864c28' })

    expect(adapter.getConversationSnapshot().conversationId).toBe('6ae6cd7d7aa3095d7b864c28')
  })

  it('extracts conversation ids from detail paths', () => {
    const adapter = createGlmAdapter({ href: 'https://chatglm.cn/main/gdetail/68abc' })

    expect(adapter.getConversationSnapshot().conversationId).toBe('68abc')
  })

  it('ignores lookalike hosts', () => {
    const adapter = createGlmAdapter({ href: 'https://chatglm.cn.evil.example/main/alltoolsdetail' })

    expect(adapter.getConversationSnapshot()).toEqual({ conversationId: undefined, conversationUrl: undefined })
  })

  it('writes the prompt into the GLM textarea and clicks the send control', async () => {
    document.body.innerHTML = `
      <div class="input-outer">
        <div class="input-box">
          <div class="input-wrap flex flex-col">
            <div class="input-box-inner">
              <textarea class="scroll-display-none" placeholder="和我聊聊"></textarea>
            </div>
            <div class="enter is-main-chat m-three-row"><img class="enter_icon" alt="" /></div>
          </div>
        </div>
      </div>
    `
    const editor = document.querySelector<HTMLTextAreaElement>('textarea.scroll-display-none')!
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)
    const send = document.querySelector<HTMLElement>('.enter.is-main-chat')!
    const clickSpy = vi.fn()
    send.addEventListener('click', clickSpy)
    const userMessage = document.createElement('div')
    userMessage.className = 'question-item'

    const promise = createGlmAdapter({ inputTimeoutMs: 500 }).fillAndSend('请只回复两个字：收到')
    await vi.waitFor(() => expect(clickSpy).toHaveBeenCalled())
    expect(inputListener).toHaveBeenCalledTimes(1)
    document.querySelector<HTMLTextAreaElement>('textarea.scroll-display-none')!.value = ''
    document.body.append(userMessage)
    await promise
  })

  it('reads the reply wrap and skips the reasoning wrap', () => {
    document.body.innerHTML = `
      <div class="answer">
        <div class="answer-content">
          <div class="answer-content-wrap text-advance-thinking-content">
            <div class="markdown-body md-body"><p>先想一下怎么回答</p></div>
          </div>
          <div class="answer-content-wrap">
            <div class="markdown-body md-body"><p>收到</p></div>
          </div>
        </div>
      </div>
    `

    expect(createGlmAdapter().getAllAssistantReplies()).toEqual(['收到'])
  })

  it('counts the question wrap GLM renders for each prompt', () => {
    document.body.innerHTML = `
      <div class="conversation question"><div class="question-text-style">请只回复两个字：收到</div></div>
    `

    expect(document.querySelectorAll('.conversation.question')).toHaveLength(1)
  })

  it('reads the searching state of the send control as generating', () => {
    document.body.innerHTML = '<div class="enter is-main-chat searching"></div>'

    expect(createGlmAdapter().isGenerating()).toBe(true)
  })
})
