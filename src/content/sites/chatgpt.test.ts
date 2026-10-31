// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createChatGptAdapter } from './chatgpt'
import { readEditorText } from './contentEditable'

describe('ChatGPT site adapter', () => {
  it('extracts ChatGPT conversation ids and normalized safe urls', () => {
    const adapter = createChatGptAdapter({ href: 'https://chatgpt.com/c/abc-123?model=gpt-5' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'abc-123',
      conversationUrl: 'https://chatgpt.com/c/abc-123?model=gpt-5',
    })
  })

  it('extracts conversation ids from ChatGPT GPTs conversation urls', () => {
    const adapter = createChatGptAdapter({ href: 'https://chatgpt.com/g/g-LrdzaEiqT-fei-fei-jiao-lian/c/abc-123?model=gpt-5' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: 'abc-123',
      conversationUrl: 'https://chatgpt.com/g/g-LrdzaEiqT-fei-fei-jiao-lian/c/abc-123?model=gpt-5',
    })
  })

  it('does not report non-ChatGPT urls', () => {
    const adapter = createChatGptAdapter({ href: 'https://chatgpt.com.evil.example/c/abc-123' })

    expect(adapter.getConversationSnapshot()).toEqual({
      conversationId: undefined,
      conversationUrl: undefined,
    })
  })

  it('writes prompt text into the ProseMirror composer', async () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <div contenteditable="true" class="ProseMirror" id="prompt-textarea" role="textbox" aria-label="与 ChatGPT 聊天">
          <p data-placeholder="有问题，尽管问" class="placeholder"><br></p>
        </div>
      </form>
    `
    const editor = document.querySelector<HTMLElement>('#prompt-textarea')!
    const inputListener = vi.fn()
    editor.addEventListener('input', inputListener)

    await createChatGptAdapter().fillAndSend('你好 <test>', false)

    expect(editor.textContent).toBe('你好 <test>')
    expect(editor.querySelector('test')).toBeNull()
    expect(inputListener).toHaveBeenCalledTimes(1)
  })

  it('waits for the ChatGPT send button before clicking', async () => {
    document.body.innerHTML = `
      <form data-type="unified-composer">
        <div contenteditable="true" class="ProseMirror" id="prompt-textarea" role="textbox"></div>
        <button type="button" aria-label="启动语音功能" disabled>Voice</button>
      </form>
    `
    const voiceButton = document.querySelector<HTMLButtonElement>('button')!
    const clickListener = vi.fn()
    voiceButton.addEventListener('click', clickListener)
    window.setTimeout(() => {
      voiceButton.disabled = false
      voiceButton.setAttribute('aria-label', '发送提示')
    }, 20)

    await createChatGptAdapter({ inputTimeoutMs: 250 }).fillAndSend('hello', true)

    expect(clickListener).toHaveBeenCalledTimes(1)
  })

  it('reads assistant markdown replies without action button text', () => {
    document.body.innerHTML = `
      <section data-turn="assistant" data-testid="conversation-turn-2">
        <div data-message-author-role="assistant" data-message-id="reply-1">
          <div class="markdown">
            <p>你好！今天想聊点什么？</p>
            <ul><li><p>调研</p></li><li><p>写代码</p></li></ul>
          </div>
        </div>
        <div aria-label="回复操作"><button aria-label="复制回复">复制回复</button></div>
      </section>
    `

    expect(createChatGptAdapter().getAllAssistantReplies()).toEqual(['你好！今天想聊点什么？\n\n调研\n\n写代码'])
  })

  it('uses the ChatGPT copy action to read markdown replies and restores the clipboard', async () => {
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
      <section data-turn="assistant" data-testid="conversation-turn-2">
        <div data-message-author-role="assistant" data-message-id="reply-1">
          <div class="markdown">
            <p>标题</p>
            <pre><code>const answer = 42</code></pre>
          </div>
        </div>
        <div aria-label="回复操作">
          <button aria-label="复制回复" data-testid="copy-turn-action-button">复制</button>
        </div>
      </section>
    `
    document.querySelector<HTMLButtonElement>('[data-testid="copy-turn-action-button"]')?.addEventListener('click', () => {
      clipboardText = '标题\n\n```ts\nconst answer = 42\n```'
    })
    const response = document.querySelector('[data-message-author-role="assistant"]')!

    const copied = await createChatGptAdapter({ clipboardPollMs: 5, clipboardTimeoutMs: 50 }).readResponseTextFromCopy?.(response)

    expect(copied).toBe('标题\n\n```ts\nconst answer = 42\n```')
    expect(clipboardText).toBe('用户原来的剪贴板')
  })

  it('uses the turn copy action instead of code block copy buttons', async () => {
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
      <section data-turn="assistant" data-testid="conversation-turn-4">
        <div data-message-author-role="assistant" data-message-id="reply-1" data-turn-start-message="true">
          <div class="markdown">
            <p>完整回复开头</p>
            <pre>
              <button aria-label="复制">复制代码</button>
              <code>const partial = true</code>
            </pre>
            <p>完整回复结尾</p>
          </div>
        </div>
        <div aria-label="回复操作" role="group">
          <button aria-label="复制回复" data-testid="copy-turn-action-button">复制回复</button>
        </div>
      </section>
    `
    document.querySelector<HTMLButtonElement>('pre button[aria-label="复制"]')?.addEventListener('click', () => {
      clipboardText = 'const partial = true'
    })
    document.querySelector<HTMLButtonElement>('[data-testid="copy-turn-action-button"]')?.addEventListener('click', () => {
      clipboardText = '完整回复开头\n\n```ts\nconst partial = true\n```\n\n完整回复结尾'
    })
    const response = document.querySelector('[data-message-author-role="assistant"]')!

    const copied = await createChatGptAdapter({ clipboardPollMs: 5, clipboardTimeoutMs: 50 }).readResponseTextFromCopy?.(response)

    expect(copied).toBe('完整回复开头\n\n```ts\nconst partial = true\n```\n\n完整回复结尾')
    expect(clipboardText).toBe('用户原来的剪贴板')
  })

  it('converts ChatGPT reply DOM to markdown when copy output is unavailable', () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant">
        <div class="markdown">
          <h2>方案</h2>
          <p><strong>结论</strong>：可以做</p>
          <ul><li>先做复制</li><li>再做兜底</li></ul>
          <pre><code>const ok = true</code></pre>
        </div>
      </div>
    `
    const response = document.querySelector('[data-message-author-role="assistant"]')!

    expect(createChatGptAdapter().readResponseMarkdown?.(response)).toBe('## 方案\n\n**结论**：可以做\n\n- 先做复制\n- 再做兜底\n\n```\nconst ok = true\n```')
  })

  it('extracts and deduplicates generated images from ChatGPT image turns', () => {
    document.body.innerHTML = `
      <div class="agent-turn">
        <div data-conversation-screenshot-content>
          <div class="group/imagegen-image">
            <img
              id="generated-image"
              width="1254"
              height="1254"
              alt="已生成图片：温馨午餐时光的小猫"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-image&sig=signed"
            >
            <img
              width="1254"
              height="1254"
              alt=""
              aria-hidden="true"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-image&sig=signed"
            >
            <img
              alt=""
              aria-hidden="true"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-image&sig=signed"
            >
          </div>
          <button aria-label="编辑图片">编辑</button>
        </div>
      </div>
    `

    const adapter = createChatGptAdapter()
    const responses = adapter.getResponseContainers()

    expect(responses).toHaveLength(1)
    expect(responses[0]).toBe(document.querySelector('[data-conversation-screenshot-content]'))
    expect(adapter.readResponseImages?.(responses[0])).toEqual([
      {
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image&sig=signed',
        alt: '已生成图片：温馨午餐时光的小猫',
        width: 1254,
        height: 1254,
      },
    ])
  })

  it('keeps standalone image turns when older text turns are also present', () => {
    document.body.innerHTML = `
      <section data-turn="assistant" data-testid="conversation-turn-1">
        <div data-message-author-role="assistant" data-message-id="reply-1">旧的文字回复</div>
      </section>
      <div class="agent-turn">
        <div data-conversation-screenshot-content>
          <img
            alt="已生成图片"
            src="https://chatgpt.com/backend-api/estuary/content?id=file-image"
          >
        </div>
      </div>
    `

    const responses = createChatGptAdapter().getResponseContainers()

    expect(responses).toHaveLength(2)
    expect(responses[1]).toBe(document.querySelector('[data-conversation-screenshot-content]'))
  })

  it('does not treat the user prompt screenshot container as an image reply', () => {
    document.body.innerHTML = `
      <section data-turn="user" data-testid="conversation-turn-1">
        <div data-conversation-screenshot-content>
          <p id="user-prompt">画一个可爱的小猫</p>
        </div>
      </section>
      <section
        data-turn="assistant"
        data-turn-id="request-WEB:image-request"
        data-testid="conversation-turn-2"
      >
        <div data-conversation-screenshot-content>
          <button type="button">Thought for 35s</button>
          <div class="group/imagegen-image">
            <img
              width="1254"
              height="1254"
              alt="已生成图片：可爱小猫咪的梦幻时光"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-image"
            >
          </div>
          <div aria-label="回复操作" role="group">
            <button data-testid="copy-turn-action-button" aria-label="复制回复">复制回复</button>
          </div>
        </div>
      </section>
    `

    const adapter = createChatGptAdapter()
    const responses = adapter.getResponseContainers()

    expect(responses).toEqual([
      document.querySelector('section[data-turn="assistant"] [data-conversation-screenshot-content]'),
    ])
    expect(adapter.getAllAssistantReplies()).toEqual([])
    expect(adapter.findResponseContainer(document.querySelector('#user-prompt'))).toBeNull()
  })

  it('keeps assistant screenshot text turns after an image reply', () => {
    document.body.innerHTML = `
      <section data-turn="assistant" data-testid="conversation-turn-2">
        <div data-conversation-screenshot-content>
          <div class="group/imagegen-image">
            <img
              alt="已生成图片：可爱小猫咪"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-image"
            >
          </div>
        </div>
      </section>
      <section data-turn="user" data-testid="conversation-turn-3">
        <div data-conversation-screenshot-content>
          <p id="user-follow-up">再描述一下这张图</p>
        </div>
      </section>
      <section data-turn="assistant" data-testid="conversation-turn-4">
        <div data-conversation-screenshot-content>
          <div class="markdown">
            <p id="assistant-follow-up">这是一只毛茸茸的小猫，正在柔和的灯光下看向镜头。</p>
          </div>
          <div aria-label="回复操作" role="group">
            <button data-testid="copy-turn-action-button" aria-label="复制回复">复制回复</button>
          </div>
        </div>
      </section>
    `

    const adapter = createChatGptAdapter()
    const responses = adapter.getResponseContainers()

    expect(responses).toEqual([
      document.querySelector('section[data-testid="conversation-turn-2"] [data-conversation-screenshot-content]'),
      document.querySelector('section[data-testid="conversation-turn-4"] [data-conversation-screenshot-content]'),
    ])
    expect(adapter.getAllAssistantReplies()).toEqual(['这是一只毛茸茸的小猫，正在柔和的灯光下看向镜头。'])
    expect(adapter.findResponseContainer(document.querySelector('#assistant-follow-up'))).toBe(responses[1])
    expect(adapter.findResponseContainer(document.querySelector('#user-follow-up'))).toBeNull()
  })

  it('extracts multiple generated images from the selected image and thumbnail strip', () => {
    document.body.innerHTML = `
      <section data-turn="assistant" data-testid="conversation-turn-6">
        <div data-conversation-screenshot-content>
          <div class="group/imagegen-image">
            <img
              width="1254"
              height="1254"
              alt="已生成图片"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-image-1&sig=one"
            >
            <img
              alt=""
              aria-hidden="true"
              src="https://chatgpt.com/backend-api/estuary/content?id=file-image-1&sig=one"
            >
          </div>
          <div class="relative shrink-0">
            <button type="button">
              <div class="group/imagegen-image">
                <img
                  width="1254"
                  height="1254"
                  alt="已生成图片"
                  src="https://chatgpt.com/backend-api/estuary/content?id=file-image-1&sig=one"
                >
              </div>
            </button>
            <button type="button">
              <div class="group/imagegen-image">
                <img
                  width="1254"
                  height="1254"
                  alt="已生成图片"
                  src="https://chatgpt.com/backend-api/estuary/content?id=file-image-2&sig=two"
                >
              </div>
            </button>
            <button type="button">
              <div class="group/imagegen-image">
                <img
                  width="1254"
                  height="1254"
                  alt="已生成图片"
                  src="https://chatgpt.com/backend-api/estuary/content?id=file-image-3&sig=three"
                >
              </div>
            </button>
          </div>
        </div>
      </section>
    `

    const adapter = createChatGptAdapter()
    const responses = adapter.getResponseContainers()

    expect(responses).toHaveLength(1)
    expect(adapter.readResponseImages?.(responses[0])).toEqual([
      {
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image-1&sig=one',
        alt: '已生成图片',
        width: 1254,
        height: 1254,
      },
      {
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image-2&sig=two',
        alt: '已生成图片',
        width: 1254,
        height: 1254,
      },
      {
        sourceUrl: 'https://chatgpt.com/backend-api/estuary/content?id=file-image-3&sig=three',
        alt: '已生成图片',
        width: 1254,
        height: 1254,
      },
    ])
  })

  it('treats ChatGPT streaming busy indicators as generating even without a visible stop button', () => {
    document.body.innerHTML = `
      <section data-turn="assistant" data-testid="conversation-turn-2">
        <div data-message-author-role="assistant" data-message-id="reply-1">
          <div class="markdown"><p>先输出的一段内容</p></div>
          <div class="result-streaming pulse" aria-busy="true"></div>
        </div>
      </section>
    `

    expect(createChatGptAdapter().isGenerating()).toBe(true)
  })

  it('fills the current ChatGPT composer rendered inside [data-composer-body]', async () => {
    document.body.innerHTML = `
      <div data-composer-body>
        <div class="ProseMirror" contenteditable="true" role="textbox" aria-label="询问 ChatGPT"><p><br></p></div>
        <button type="button" aria-label="添加文件等内容"></button>
        <button type="button" aria-label="选择 ChatGPT 模型"></button>
        <button type="submit" aria-label="发送"></button>
      </div>
    `
    const editor = document.querySelector<HTMLElement>('[data-composer-body] .ProseMirror')!
    const attachButton = document.querySelectorAll<HTMLButtonElement>('button')[0]!
    const modelButton = document.querySelectorAll<HTMLButtonElement>('button')[1]!
    const sendButton = document.querySelector<HTMLButtonElement>('button[type="submit"]')!
    const attachListener = vi.fn()
    const modelListener = vi.fn()
    const clickListener = vi.fn()
    attachButton.addEventListener('click', attachListener)
    modelButton.addEventListener('click', modelListener)
    sendButton.addEventListener('click', event => {
      event.preventDefault()
      clickListener()
    })

    await createChatGptAdapter().fillAndSend('新界面提示词', true)

    expect(editor.textContent).toBe('新界面提示词')
    expect(clickListener).toHaveBeenCalledTimes(1)
    expect(attachListener).not.toHaveBeenCalled()
    expect(modelListener).not.toHaveBeenCalled()
  })

  it('prefers the visible composer over a hidden legacy editor', async () => {
    document.body.innerHTML = `
      <div style="display: none;"><div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox"></div></div>
      <div data-composer-body>
        <div class="ProseMirror" contenteditable="true" role="textbox"><p><br></p></div>
      </div>
    `
    const hiddenEditor = document.querySelector<HTMLElement>('#prompt-textarea')!
    const visibleEditor = document.querySelector<HTMLElement>('[data-composer-body] .ProseMirror')!

    await createChatGptAdapter().fillAndSend('只写可见输入框', false)

    expect(readEditorText(visibleEditor)).toBe('只写可见输入框')
    expect(hiddenEditor.textContent).toBe('')
  })

})
