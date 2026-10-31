import type { ChatSiteAdapter, ConversationSnapshot } from './types'
import { keepDeepestResponseContainers } from '../responseContainers'
import { editorHoldsText, setContentEditableText, submitEditorWithKeyboard, waitForPromptDispatch } from './contentEditable'
import { extractMarkdownFromDom } from './domMarkdown'
import { buttonLabelMatches, describeElement, extractCleanTextFromDom, findClosestMatchingAncestor } from './domText'
import { isClickableButton, waitForElement } from './waitForElement'

const QWEN_HOST = 'chat.qwen.ai'
const QWEN_ORIGIN = `https://${QWEN_HOST}`
const QWEN_HOME_URL = `${QWEN_ORIGIN}/`
const DEFAULT_INPUT_TIMEOUT_MS = 9000
const DEFAULT_SEND_BUTTON_TIMEOUT_MS = 5000

const QWEN_SELECTORS = {
  editor: 'textarea.message-input-textarea, textarea[placeholder], form textarea, [contenteditable="true"][role="textbox"]',
  composer: '.chat-prompt-container, .message-input-container, form, [class*="chat-input"]',
  response: '.qwen-chat-message-assistant .response-message-content.phase-answer, .qwen-chat-message-assistant .response-message-content',
  responseContainer: '.qwen-chat-message-assistant',
  userMessage: '.qwen-chat-message-user',
  sendButton: 'button.send-button, button[aria-label*="发送"], button[aria-label*="Send"], .chat-prompt-send-button button',
  stopButton: 'button.stop-button, button[aria-label*="停止"]',
  copyButton: 'button.copy-response-button, button[aria-label="复制"], button[aria-label="Copy"]',
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'TEXTAREA', 'SVG'])

interface QwenAdapterOptions {
  href?: string
  inputTimeoutMs?: number
}

export function createQwenAdapter(options: QwenAdapterOptions = {}): ChatSiteAdapter {
  const inputTimeoutMs = options.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS

  function currentHref(): string {
    return options.href ?? location.href
  }

  function getConversationSnapshot(): ConversationSnapshot {
    return getQwenConversationLocation(currentHref())
  }

  function getConversationId(): string {
    return getConversationSnapshot().conversationId || '__default__'
  }

  function getResponseContainers(): Element[] {
    return [...document.querySelectorAll(QWEN_SELECTORS.response)]
  }

  function getAllAssistantReplies(): string[] {
    return keepDeepestResponseContainers(getResponseContainers()).map(container => extractCleanText(container)).filter(Boolean)
  }

  async function fillAndSend(content: string, autoSend = true): Promise<void> {
    const editor = await waitForQwenEditor(inputTimeoutMs)
    const messageCountBefore = document.querySelectorAll(QWEN_SELECTORS.userMessage).length

    setQwenEditorText(editor, content)
    if (!editorHoldsText(editor, content)) {
      throw new Error('Qwen 输入框没有接收提示词（页面可能仍在加载），请在页面上手动确认后重试')
    }

    if (!autoSend) return

    const promptDispatched = () =>
      document.querySelectorAll(QWEN_SELECTORS.userMessage).length > messageCountBefore || isQwenGenerating()
    const sendButton = await waitForQwenSendButton(editor, Math.min(inputTimeoutMs, DEFAULT_SEND_BUTTON_TIMEOUT_MS))

    if (sendButton) {
      sendButton.click()
      if (!(await waitForPromptDispatch({ editor, isDispatched: promptDispatched }))) submitEditorWithKeyboard(editor)
      return
    }

    submitEditorWithKeyboard(editor)
    if (await waitForPromptDispatch({ editor, isDispatched: promptDispatched })) return

    throw new Error('Qwen 发送失败：页面里没有可用的发送按钮，回车提交也没有生效，请手动发送一次后点击"重新同步完整回复"')
  }

  return {
    id: 'qwen',
    getConversationSnapshot,
    getConversationId,
    getResponseContainers,
    getAllAssistantReplies,
    readResponseText: extractCleanText,
    readResponseMarkdown: extractMarkdownFromDom,
    findResponseContainer,
    isGenerating: isQwenGenerating,
    stopGenerating: stopQwenGenerating,
    fillAndSend,
    collectPromptDiagnostics,
  }
}

export function getQwenConversationLocation(href: string): ConversationSnapshot {
  const url = parseSafeQwenUrl(href)
  if (!url) return {}

  return {
    conversationId: extractConversationId(url),
    conversationUrl: url.href,
  }
}

function parseSafeQwenUrl(value: string | undefined): URL | undefined {
  if (!value || !value.startsWith(QWEN_HOME_URL)) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === QWEN_HOST ? url : undefined
  } catch {
    return undefined
  }
}

function extractConversationId(url: URL): string | undefined {
  const match = url.pathname.match(/^\/(?:c|chat)\/([^/]+)/)
  const conversationId = match?.[1]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

async function waitForQwenEditor(timeoutMs: number): Promise<HTMLElement> {
  try {
    return await waitForElement(QWEN_SELECTORS.editor, timeoutMs)
  } catch {
    throw new Error('Qwen 输入框未出现（页面可能仍在加载或登录态失效），请刷新该角色的页面后重试')
  }
}

function setQwenEditorText(editor: HTMLElement, content: string): void {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    editor.focus()
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')
    if (descriptor?.set) descriptor.set.call(editor, content)
    else editor.value = content
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }))
    editor.dispatchEvent(new Event('change', { bubbles: true }))
    return
  }

  setContentEditableText(editor, content)
}


async function waitForQwenSendButton(editor: HTMLElement, timeoutMs: number): Promise<HTMLElement | undefined> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const button = findQwenSendButton(editor)
    if (button) return button
    await new Promise(resolve => window.setTimeout(resolve, 50))
  }

  return undefined
}

function qwenComposerScopes(editor: HTMLElement): Element[] {
  const scopes: Element[] = []
  const add = (element: Element | null | undefined) => {
    if (element && !scopes.includes(element)) scopes.push(element)
  }

  add(editor.closest(QWEN_SELECTORS.composer))
  add(editor.closest('form'))
  add(editor.parentElement?.parentElement?.parentElement)
  add(editor.parentElement)
  add(document.body)

  return scopes
}

function findQwenSendButton(editor: HTMLElement): HTMLElement | undefined {
  for (const scope of qwenComposerScopes(editor)) {
    const candidates = [...scope.querySelectorAll<HTMLElement>(QWEN_SELECTORS.sendButton)]
    const match = candidates.filter(isUsableQwenSendButton).pop()
    if (match) return match
  }

  return undefined
}

function isUsableQwenSendButton(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false
  if (element instanceof HTMLButtonElement && element.disabled) return false
  if (buttonLabelMatches(element, /attach|upload|file|camera|image|voice|microphone|附件|上传|图片|语音|登录|login/i)) return false
  return isVisibleInteractiveElement(element)
}

function collectPromptDiagnostics(): Record<string, unknown> {
  return {
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    title: document.title,
    editorMatches: [...document.querySelectorAll(QWEN_SELECTORS.editor)].slice(0, 5).map(describeElement),
    sendButtonMatches: [...document.querySelectorAll(QWEN_SELECTORS.sendButton)].slice(0, 5).map(describeElement),
    visibleButtonSamples: [...document.querySelectorAll('[role="button"], button')].slice(0, 12).map(describeElement),
  }
}

function extractCleanText(node: Node): string {
  return extractCleanTextFromDom(node, { skipTags: SKIP_TAGS })
}

function findResponseContainer(element: Element | null): Element | null {
  return findClosestMatchingAncestor(element, QWEN_SELECTORS.response)
}

function isQwenGenerating(): boolean {
  return Boolean(findQwenStopButton())
}

async function stopQwenGenerating(): Promise<boolean> {
  const button = findQwenStopButton()
  if (!button) return false
  button.click()
  return true
}

function findQwenStopButton(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(QWEN_SELECTORS.stopButton)].find(button =>
    buttonLabelMatches(button, /stop|stopping|停止|中止/) && isClickableQwenElement(button),
  )
}

function isClickableQwenElement(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false
  if (element instanceof HTMLButtonElement) return isClickableButton(element)
  return isVisibleInteractiveElement(element)
}

function isVisibleInteractiveElement(element: Element): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false
  return true
}
