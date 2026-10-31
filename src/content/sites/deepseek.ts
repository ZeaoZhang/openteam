import type { ChatSiteAdapter, ConversationSnapshot } from './types'
import { keepDeepestResponseContainers } from '../responseContainers'
import { readEditorText, setContentEditableText, submitEditorWithKeyboard, waitForPromptDispatch } from './contentEditable'
import { extractMarkdownFromDom } from './domMarkdown'
import { buttonLabelMatches, describeElement, extractCleanTextFromDom, findClosestMatchingAncestor } from './domText'
import { isClickableButton, waitForElement } from './waitForElement'

const DEEPSEEK_HOST = 'chat.deepseek.com'
const DEEPSEEK_ORIGIN = `https://${DEEPSEEK_HOST}`
const DEEPSEEK_HOME_URL = `${DEEPSEEK_ORIGIN}/`
const DEFAULT_INPUT_TIMEOUT_MS = 9000
const DEFAULT_SEND_BUTTON_TIMEOUT_MS = 5000

const DEEPSEEK_SELECTORS = {
  editor:
    'textarea[name="search"], textarea[placeholder*="DeepSeek"], textarea[placeholder*="给 DeepSeek 发送消息"], textarea[placeholder*="发送消息"], [contenteditable="true"][role="textbox"]',
  response: '[data-virtual-list-item-key] .ds-message .ds-markdown:not(.ds-think-content .ds-markdown)',
  responseContainer: '[data-virtual-list-item-key]',
  composer: '.aaff8b8f, ._77cefa5, [class*="composer"]',
  sendButton:
    '.bf38813a [role="button"], .bf38813a button, [role="button"]._52c986b, button._52c986b, [role="button"].ds-icon-button, button.ds-icon-button, [role="button"].ds-button--primary.ds-button--filled.ds-button--circle, button.ds-button--primary.ds-button--filled.ds-button--circle',
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'TEXTAREA', 'SVG'])

interface DeepSeekAdapterOptions {
  href?: string
  inputTimeoutMs?: number
}

export function createDeepSeekAdapter(options: DeepSeekAdapterOptions = {}): ChatSiteAdapter {
  const inputTimeoutMs = options.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS

  function currentHref(): string {
    return options.href ?? location.href
  }

  function getConversationSnapshot(): ConversationSnapshot {
    return getDeepSeekConversationLocation(currentHref())
  }

  function getConversationId(): string {
    return getConversationSnapshot().conversationId || '__default__'
  }

  function getResponseContainers(): Element[] {
    return [...document.querySelectorAll(DEEPSEEK_SELECTORS.response)].filter(isFinalResponseMarkdown)
  }

  function getAllAssistantReplies(): string[] {
    return keepDeepestResponseContainers(getResponseContainers()).map(container => extractCleanText(container)).filter(Boolean)
  }

  async function fillAndSend(content: string, autoSend = true): Promise<void> {
    const editor = await waitForDeepSeekEditor(inputTimeoutMs)
    const messageCountBefore = document.querySelectorAll(DEEPSEEK_SELECTORS.responseContainer).length

    setDeepSeekEditorText(editor, content)
    if (readDeepSeekEditorText(editor) !== normalizeTextareaValue(content).trim()) {
      throw new Error('DeepSeek 输入框没有接收提示词（页面可能仍在加载），请在页面上手动确认后重试')
    }

    if (!autoSend) return

    const promptDispatched = () =>
      document.querySelectorAll(DEEPSEEK_SELECTORS.responseContainer).length > messageCountBefore || isDeepSeekGenerating()
    const sendButton = await waitForDeepSeekSendButton(editor, Math.min(inputTimeoutMs, DEFAULT_SEND_BUTTON_TIMEOUT_MS))

    if (sendButton) {
      sendButton.click()
      if (!(await waitForPromptDispatch({ editor, isDispatched: promptDispatched }))) submitEditorWithKeyboard(editor)
      return
    }

    submitEditorWithKeyboard(editor)
    if (await waitForPromptDispatch({ editor, isDispatched: promptDispatched })) return

    throw new Error('DeepSeek 发送失败：页面里没有可用的发送按钮，回车提交也没有生效，请手动发送一次后点击"重新同步完整回复"')
  }

  return {
    id: 'deepseek',
    getConversationSnapshot,
    getConversationId,
    getResponseContainers,
    getAllAssistantReplies,
    readResponseText: extractCleanText,
    readResponseMarkdown: extractMarkdownFromDom,
    findResponseContainer,
    isGenerating: isDeepSeekGenerating,
    stopGenerating: stopDeepSeekGenerating,
    fillAndSend,
    collectPromptDiagnostics,
  }
}

export function getDeepSeekConversationLocation(href: string): ConversationSnapshot {
  const url = parseSafeDeepSeekUrl(href)
  if (!url) return {}

  return {
    conversationId: extractConversationId(url),
    conversationUrl: url.href,
  }
}

function parseSafeDeepSeekUrl(value: string | undefined): URL | undefined {
  if (!value || !value.startsWith(DEEPSEEK_HOME_URL)) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === DEEPSEEK_HOST ? url : undefined
  } catch {
    return undefined
  }
}

function extractConversationId(url: URL): string | undefined {
  const match = url.pathname.match(/^\/a\/chat\/s\/([^/]+)/)
  const conversationId = match?.[1]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

async function waitForDeepSeekEditor(timeoutMs: number): Promise<HTMLElement> {
  try {
    return await waitForElement(DEEPSEEK_SELECTORS.editor, timeoutMs)
  } catch {
    throw new Error('DeepSeek 输入框未出现（页面可能仍在加载或登录态失效），请刷新该角色的页面后重试')
  }
}

function setDeepSeekEditorText(editor: HTMLElement, content: string): void {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    setInputValue(editor, content)
    return
  }
  setContentEditableText(editor, content)
}

function setInputValue(editor: HTMLTextAreaElement | HTMLInputElement, content: string): void {
  editor.focus()
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor), 'value')
  if (descriptor?.set) descriptor.set.call(editor, content)
  else editor.value = content
  editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: content }))
  editor.dispatchEvent(new Event('change', { bubbles: true }))
}

function readDeepSeekEditorText(editor: HTMLElement): string {
  const text = editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement ? editor.value : readEditorText(editor)
  return normalizeTextareaValue(text).trim()
}

function normalizeTextareaValue(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

async function waitForDeepSeekSendButton(editor: HTMLElement, timeoutMs: number): Promise<HTMLElement | undefined> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const button = findDeepSeekSendButton(editor)
    if (button) return button
    await new Promise(resolve => window.setTimeout(resolve, 50))
  }

  return undefined
}

function findDeepSeekSendButton(editor: HTMLElement): HTMLElement | undefined {
  const composer = editor.closest(DEEPSEEK_SELECTORS.composer) ?? document.body
  const candidates = [...composer.querySelectorAll<HTMLElement>(DEEPSEEK_SELECTORS.sendButton)]
  return candidates.reverse().find(isDeepSeekSendButton)
}

function isDeepSeekSendButton(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false
  if (element instanceof HTMLButtonElement && element.disabled) return false
  if (element.classList.contains('ds-toggle-button')) return false
  if (buttonLabelMatches(element, /attach|upload|file|camera|image|voice|microphone|附件|上传|图片|语音/)) return false
  if (
    !element.classList.contains('_52c986b') &&
    !element.classList.contains('ds-icon-button') &&
    !(element.classList.contains('ds-button--primary') &&
      element.classList.contains('ds-button--filled') &&
      element.classList.contains('ds-button--circle'))
  ) return false
  return isVisibleInteractiveElement(element)
}

function collectPromptDiagnostics(): Record<string, unknown> {
  return {
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    title: document.title,
    editorMatches: [...document.querySelectorAll(DEEPSEEK_SELECTORS.editor)].slice(0, 5).map(describeElement),
    sendButtonMatches: [...document.querySelectorAll(DEEPSEEK_SELECTORS.sendButton)].slice(0, 5).map(describeElement),
    visibleButtonSamples: [...document.querySelectorAll('[role="button"], button')].slice(0, 12).map(describeElement),
  }
}

function extractCleanText(node: Node): string {
  return extractCleanTextFromDom(node, { skipTags: SKIP_TAGS })
}

function findResponseContainer(element: Element | null): Element | null {
  const finalMarkdown = findClosestMatchingAncestor(element, DEEPSEEK_SELECTORS.response)
  return finalMarkdown && isFinalResponseMarkdown(finalMarkdown) ? finalMarkdown : null
}

function isFinalResponseMarkdown(element: Element): boolean {
  if (element.closest('.ds-think-content')) return false
  return Boolean(element.closest(DEEPSEEK_SELECTORS.responseContainer))
}

function isDeepSeekGenerating(): boolean {
  return Boolean(findDeepSeekStopButton())
}

async function stopDeepSeekGenerating(): Promise<boolean> {
  const button = findDeepSeekStopButton()
  if (!button) return false
  button.click()
  return true
}

function findDeepSeekStopButton(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[role="button"], button')].find(button => buttonLabelMatches(button, /stop|stopping|停止|中止/) && isClickableDeepSeekButton(button))
}

function isClickableDeepSeekButton(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false
  if (element instanceof HTMLButtonElement) return isClickableButton(element)
  return isVisibleInteractiveElement(element)
}

function isVisibleInteractiveElement(element: Element): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false
  return true
}
