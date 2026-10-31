import type { ChatSiteAdapter, ConversationSnapshot } from './types'
import { keepDeepestResponseContainers } from '../responseContainers'
import { editorHoldsText, setContentEditableText, submitEditorWithKeyboard, waitForPromptDispatch } from './contentEditable'
import { extractMarkdownFromDom } from './domMarkdown'
import { buttonLabelMatches, describeElement, extractCleanTextFromDom, findClosestMatchingAncestor } from './domText'
import { isClickableButton, waitForElement } from './waitForElement'

const GLM_HOST = 'chatglm.cn'
const GLM_ORIGIN = `https://${GLM_HOST}`
const DEFAULT_INPUT_TIMEOUT_MS = 9000
const DEFAULT_SEND_BUTTON_TIMEOUT_MS = 5000

const GLM_SELECTORS = {
  editor:
    'textarea.scroll-display-none, .input-box-inner textarea, textarea[placeholder*="和我聊"], [contenteditable="true"][role="textbox"], .input-box [contenteditable="true"]',
  composer: '.input-wrap, .input-outer, .input-box, form',
  response:
    '.answer-item .markdown-body, .chat-item-answer .markdown-body, .answer-content .markdown-body, [class*="answer"] .markdown-body',
  responseContainer: '.answer-item, .chat-item-answer, [class*="answer-item"], [class*="answer-content"]',
  userMessage: '.question-item, .chat-item-question, [class*="question-item"], [class*="question-content"]',
  sendButton:
    '.enter.is-main-chat, .enter-button, [class*="send-btn"], button[aria-label*="发送"], button[aria-label*="Send"], [class*="send-button"]',
  stopButton: 'button[aria-label*="停止"], [class*="stop-button"], [class*="stop-generat"]',
  copyButton: '[class*="copy"]',
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'TEXTAREA', 'SVG'])

interface GlmAdapterOptions {
  href?: string
  inputTimeoutMs?: number
}

export function createGlmAdapter(options: GlmAdapterOptions = {}): ChatSiteAdapter {
  const inputTimeoutMs = options.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS

  function currentHref(): string {
    return options.href ?? location.href
  }

  function getConversationSnapshot(): ConversationSnapshot {
    return getGlmConversationLocation(currentHref())
  }

  function getConversationId(): string {
    return getConversationSnapshot().conversationId || '__default__'
  }

  function getResponseContainers(): Element[] {
    return [...document.querySelectorAll(GLM_SELECTORS.response)]
  }

  function getAllAssistantReplies(): string[] {
    return keepDeepestResponseContainers(getResponseContainers()).map(container => extractCleanText(container)).filter(Boolean)
  }

  async function fillAndSend(content: string, autoSend = true): Promise<void> {
    const editor = await waitForGlmEditor(inputTimeoutMs)
    const messageCountBefore = document.querySelectorAll(GLM_SELECTORS.userMessage).length

    setGlmEditorText(editor, content)
    if (!editorHoldsText(editor, content)) {
      throw new Error('智谱清言输入框没有接收提示词（页面可能仍在加载），请在页面上手动确认后重试')
    }

    if (!autoSend) return

    const promptDispatched = () =>
      document.querySelectorAll(GLM_SELECTORS.userMessage).length > messageCountBefore || isGlmGenerating()
    const sendButton = await waitForGlmSendButton(editor, Math.min(inputTimeoutMs, DEFAULT_SEND_BUTTON_TIMEOUT_MS))

    if (sendButton) {
      sendButton.click()
      if (!(await waitForPromptDispatch({ editor, isDispatched: promptDispatched }))) submitEditorWithKeyboard(editor)
      return
    }

    submitEditorWithKeyboard(editor)
    if (await waitForPromptDispatch({ editor, isDispatched: promptDispatched })) return

    throw new Error('智谱清言发送失败：页面里没有可用的发送按钮，回车提交也没有生效，请手动发送一次后点击"重新同步完整回复"')
  }

  return {
    id: 'glm',
    getConversationSnapshot,
    getConversationId,
    getResponseContainers,
    getAllAssistantReplies,
    readResponseText: extractCleanText,
    readResponseMarkdown: extractMarkdownFromDom,
    findResponseContainer,
    isGenerating: isGlmGenerating,
    stopGenerating: stopGlmGenerating,
    fillAndSend,
    collectPromptDiagnostics,
  }
}

export function getGlmConversationLocation(href: string): ConversationSnapshot {
  const url = parseSafeGlmUrl(href)
  if (!url) return {}

  return {
    conversationId: extractConversationId(url),
    conversationUrl: url.href,
  }
}

function parseSafeGlmUrl(value: string | undefined): URL | undefined {
  if (!value || !value.startsWith(`${GLM_ORIGIN}/`)) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === GLM_HOST ? url : undefined
  } catch {
    return undefined
  }
}

function extractConversationId(url: URL): string | undefined {
  const fromQuery = url.searchParams.get('chatId') ?? url.searchParams.get('sessionId') ?? undefined
  if (fromQuery) return fromQuery

  const match = url.pathname.match(/^\/main\/(?:gdetail|chat)\/([^/]+)/)
  const conversationId = match?.[1]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

async function waitForGlmEditor(timeoutMs: number): Promise<HTMLElement> {
  try {
    return await waitForElement(GLM_SELECTORS.editor, timeoutMs)
  } catch {
    throw new Error('智谱清言输入框未出现（页面可能仍在加载、登录态失效或停在人机验证页），请在该角色页面里完成验证后重试')
  }
}

function setGlmEditorText(editor: HTMLElement, content: string): void {
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


async function waitForGlmSendButton(editor: HTMLElement, timeoutMs: number): Promise<HTMLElement | undefined> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const button = findGlmSendButton(editor)
    if (button) return button
    await new Promise(resolve => window.setTimeout(resolve, 50))
  }

  return undefined
}

function glmComposerScopes(editor: HTMLElement): Element[] {
  const scopes: Element[] = []
  const add = (element: Element | null | undefined) => {
    if (element && !scopes.includes(element)) scopes.push(element)
  }

  add(editor.closest(GLM_SELECTORS.composer))
  add(editor.closest('form'))
  add(editor.parentElement?.parentElement?.parentElement)
  add(editor.parentElement)
  add(document.body)

  return scopes
}

function findGlmSendButton(editor: HTMLElement): HTMLElement | undefined {
  for (const scope of glmComposerScopes(editor)) {
    const candidates = [...scope.querySelectorAll<HTMLElement>(GLM_SELECTORS.sendButton)]
    const match = candidates.filter(isUsableGlmSendButton).pop()
    if (match) return match
  }

  return undefined
}

function isUsableGlmSendButton(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false
  if (element.classList.contains('disabled')) return false
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
    editorMatches: [...document.querySelectorAll(GLM_SELECTORS.editor)].slice(0, 5).map(describeElement),
    sendButtonMatches: [...document.querySelectorAll(GLM_SELECTORS.sendButton)].slice(0, 5).map(describeElement),
    visibleButtonSamples: [...document.querySelectorAll('[role="button"], button')].slice(0, 12).map(describeElement),
  }
}

function extractCleanText(node: Node): string {
  return extractCleanTextFromDom(node, { skipTags: SKIP_TAGS })
}

function findResponseContainer(element: Element | null): Element | null {
  return findClosestMatchingAncestor(element, GLM_SELECTORS.response)
}

function isGlmGenerating(): boolean {
  return Boolean(findGlmStopButton())
}

async function stopGlmGenerating(): Promise<boolean> {
  const button = findGlmStopButton()
  if (!button) return false
  button.click()
  return true
}

function findGlmStopButton(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(GLM_SELECTORS.stopButton)].find(button =>
    buttonLabelMatches(button, /stop|stopping|停止|中止/) && isClickableGlmElement(button),
  )
}

function isClickableGlmElement(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false
  if (element instanceof HTMLButtonElement) return isClickableButton(element)
  return isVisibleInteractiveElement(element)
}

function isVisibleInteractiveElement(element: Element): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false
  return true
}
