import type { ChatSiteAdapter, ConversationSnapshot } from './types'
import { keepDeepestResponseContainers } from '../responseContainers'
import { findClickableCopyButton, readResponseTextFromCopyAction } from './clipboardCopy'
import { readEditorText, setContentEditableText, submitEditorWithKeyboard, waitForPromptDispatch } from './contentEditable'
import { extractMarkdownFromDom } from './domMarkdown'
import { buttonLabelMatches, describeElement, extractCleanTextFromDom, findClosestMatchingAncestor } from './domText'
import { isClickableButton } from './waitForElement'
import { describeSamples, recordSendFailure } from './sendDiagnostics'

const GROK_HOST = 'grok.com'
const GROK_HOME_URL = `https://${GROK_HOST}/`
const DEFAULT_INPUT_TIMEOUT_MS = 9000
const DEFAULT_SEND_BUTTON_TIMEOUT_MS = 5000
const DEFAULT_LATE_SEND_BUTTON_TIMEOUT_MS = 1500
const DEFAULT_CONNECTION_CHECK_TIMEOUT_MS = 10000
const CONNECTION_BLOCKED_PATTERN = /无法开始对话|网络正在阻止|WebSockets 连接|建立 WebSocket/i
const CAPACITY_LIMITED_PATTERN = /需求量高|使用人数较多|请稍后再试|升级到 Super/i
const DEFAULT_CLIPBOARD_TIMEOUT_MS = 900
const DEFAULT_CLIPBOARD_POLL_MS = 40

const GROK_SELECTORS = {
  queryBar: '.query-bar',
  // Grok renders the composer as "#chat-input" (id) on desktop and ".query-bar" on mobile; the
  // [data-testid] variant only exists in older builds.
  chatInput: '#chat-input, [data-testid="chat-input"]',
  proseMirrorEditor:
    '#chat-input .ProseMirror[contenteditable="true"], [data-testid="chat-input"] .ProseMirror[contenteditable="true"], .query-bar .ProseMirror[contenteditable="true"], .ProseMirror[contenteditable="true"][aria-label]',
  fallbackEditor: 'textarea, input, [contenteditable="true"][role="textbox"], [contenteditable="true"]',
  sendButton:
    'button[data-testid="chat-submit"], button[data-testid*="send"], button[data-testid*="submit"], button[type="submit"], [role="button"][aria-label*="Send"], [role="button"][aria-label*="Submit"], [role="button"][data-testid*="send"], [role="button"][data-testid*="submit"]',
  response:
    '[data-testid="assistant-message"], [data-message-author-role="assistant"], [data-author="assistant"], [class*="assistant-message"]',
  userMessage: '[data-testid="user-message"], [data-message-author-role="user"], [data-author="user"]',
  copyButton: 'button[aria-label*="复制响应"], button[aria-label*="复制"], button[aria-label*="Copy"], button[data-testid*="copy"], button[title*="Copy"]',
  activityIndicator: '[aria-busy="true"], [data-testid*="thinking"], [data-testid*="generating"]',
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'TEXTAREA', 'SVG'])

interface GrokAdapterOptions {
  href?: string
  inputTimeoutMs?: number
  clipboardTimeoutMs?: number
  clipboardPollMs?: number
  connectionCheckTimeoutMs?: number
}

export function createGrokAdapter(options: GrokAdapterOptions = {}): ChatSiteAdapter {
  const inputTimeoutMs = options.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS
  const clipboardTimeoutMs = options.clipboardTimeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS
  const clipboardPollMs = options.clipboardPollMs ?? DEFAULT_CLIPBOARD_POLL_MS
  const connectionCheckTimeoutMs = options.connectionCheckTimeoutMs ?? Math.min(inputTimeoutMs, DEFAULT_CONNECTION_CHECK_TIMEOUT_MS)

  function currentHref(): string {
    return options.href ?? location.href
  }

  function getConversationSnapshot(): ConversationSnapshot {
    return getGrokConversationLocation(currentHref())
  }

  function getConversationId(): string {
    return getConversationSnapshot().conversationId || '__default__'
  }

  function getResponseContainers(): Element[] {
    return [...document.querySelectorAll(GROK_SELECTORS.response)].filter(isLikelyAssistantResponse)
  }

  function getAllAssistantReplies(): string[] {
    return keepDeepestResponseContainers(getResponseContainers()).map(container => extractCleanText(container)).filter(Boolean)
  }

  async function fillAndSend(content: string, autoSend = true): Promise<void> {
    const editor = await waitForGrokEditor(inputTimeoutMs)
    const userMessageCountBefore = document.querySelectorAll(GROK_SELECTORS.userMessage).length

    setGrokEditorText(editor, content)
    if (readGrokEditorText(editor) !== content.trim()) {
      recordSendFailure('grok', { editor, details: { stage: 'write' } })
      throw new Error('Grok 输入框没有接收提示词（页面可能仍在加载），请在页面上手动确认后重试')
    }

    if (!autoSend) return

    const promptDispatched = () =>
      document.querySelectorAll(GROK_SELECTORS.userMessage).length > userMessageCountBefore || isGrokGenerating()
    const connectionErrorsBefore = countConnectionErrors()
    const sendButton = await waitForGrokSendButton(editor, Math.min(inputTimeoutMs, DEFAULT_SEND_BUTTON_TIMEOUT_MS))

    if (sendButton) {
      sendButton.click()
      if (!(await waitForPromptDispatch({ editor, isDispatched: promptDispatched }))) submitEditorWithKeyboard(editor)
      await throwIfGrokConnectionBlocked(connectionErrorsBefore, connectionCheckTimeoutMs)
      return
    }

    submitEditorWithKeyboard(editor)
    if (await waitForPromptDispatch({ editor, isDispatched: promptDispatched })) return

    // The composer sometimes enables its submit button only after the draft reaches the site's own
    // editor state, which can happen after the keyboard fallback ran. Retry the button once.
    const lateSendButton = await waitForGrokSendButton(editor, DEFAULT_LATE_SEND_BUTTON_TIMEOUT_MS)
    if (lateSendButton) {
      lateSendButton.click()
      if (await waitForPromptDispatch({ editor, isDispatched: promptDispatched })) {
        await throwIfGrokConnectionBlocked(connectionErrorsBefore, connectionCheckTimeoutMs)
        return
      }
    }

    if (countCapacityErrors() > 0) {
      recordSendFailure('grok', { editor, details: { stage: 'capacity-limited' } })
      throw new Error('Grok 当前使用人数较多，站点提示“需求量高，请稍后再试”。请稍等几分钟后点击“重新回复”，或升级 Grok 订阅后再试')
    }

    // The prompt sometimes leaves the composer without our button press landing (the site clears the
    // draft itself), so treat a new user bubble as a successful dispatch instead of a send failure.
    if (promptDispatched()) return

    recordSendFailure('grok', { editor, details: collectSendFailureDetails(editor) })
    throw new Error('Grok 发送失败：页面里没有可用的发送按钮，回车提交也没有生效，请手动发送一次后点击"重新同步完整回复"')
  }

  return {
    id: 'grok',
    getConversationSnapshot,
    getConversationId,
    getResponseContainers,
    getAllAssistantReplies,
    readResponseText: extractCleanText,
    readResponseTextFromCopy: node => readResponseTextFromCopy(node, clipboardTimeoutMs, clipboardPollMs),
    readResponseMarkdown: extractMarkdownFromDom,
    findResponseContainer,
    isGenerating: isGrokGenerating,
    stopGenerating: stopGrokGenerating,
    fillAndSend,
    collectPromptDiagnostics,
  }
}

export function getGrokConversationLocation(href: string): ConversationSnapshot {
  const url = parseSafeGrokUrl(href)
  if (!url) return {}

  return {
    conversationId: extractConversationId(url),
    conversationUrl: url.href,
  }
}

function parseSafeGrokUrl(value: string | undefined): URL | undefined {
  if (!value || !value.startsWith(GROK_HOME_URL)) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === GROK_HOST ? url : undefined
  } catch {
    return undefined
  }
}

function extractConversationId(url: URL): string | undefined {
  const match = url.pathname.match(/^\/(?:chat|c)\/([^/]+)/)
  const conversationId = match?.[1]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

function setGrokEditorText(editor: HTMLElement, content: string): void {
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

function readGrokEditorText(editor: HTMLElement): string {
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) return editor.value.trim()
  return readEditorText(editor, { normalizeNbsp: true })
}

async function waitForGrokEditor(timeoutMs: number): Promise<HTMLElement> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const editor = findGrokEditor()
    if (editor) return editor
    await waitForNextGrokPoll()
  }

  throw new Error('Grok 输入框暂不可用，请稍后重试')
}

function findGrokEditor(): HTMLElement | undefined {
  const proseMirror = [...document.querySelectorAll<HTMLElement>(GROK_SELECTORS.proseMirrorEditor)].find(isUsableGrokEditor)
  if (proseMirror) return proseMirror

  for (const scope of grokEditorScopes()) {
    const editor = [...scope.querySelectorAll<HTMLElement>(GROK_SELECTORS.fallbackEditor)].find(isUsableGrokEditor)
    if (editor) return editor
  }

  return undefined
}

async function waitForGrokSendButton(editor: HTMLElement, timeoutMs: number): Promise<HTMLElement | undefined> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const button = findGrokSendButton(editor)
    if (button) return button
    await waitForNextGrokPoll()
  }

  return undefined
}

function findGrokSendButton(editor: HTMLElement): HTMLElement | undefined {
  for (const scope of grokComposerScopes(editor)) {
    const buttons = [...scope.querySelectorAll<HTMLElement>(GROK_SELECTORS.sendButton)]
    const candidate = buttons.reverse().find(isUsableGrokSendButton)
    if (candidate) return candidate
  }
  return undefined
}

function grokComposerScopes(editor: HTMLElement): Element[] {
  const scopes: Element[] = []

  function addScope(scope: Element | null | undefined): void {
    if (!scope || scopes.includes(scope)) return
    scopes.push(scope)
  }

  addScope(editor.closest(GROK_SELECTORS.queryBar))
  addScope(editor.closest(GROK_SELECTORS.chatInput))
  addScope(editor.closest('form'))
  addScope(document.querySelector(GROK_SELECTORS.queryBar))
  addScope(editor.parentElement)
  addScope(document.body)

  return scopes
}

function isUsableGrokSendButton(button: HTMLElement): boolean {
  if (buttonLabelMatches(button, /voice|voice mode|microphone|dictation|attach|upload|camera|photo|image|file|model select|stop|停止|中止/i)) return false

  if (button instanceof HTMLButtonElement) return isClickableButton(button) && isVisibleInteractiveElement(button)
  if (button.getAttribute('aria-disabled') === 'true') return false

  return isVisibleInteractiveElement(button)
}

function grokEditorScopes(): Element[] {
  const scopes: Element[] = []
  const chatInput = document.querySelector(GROK_SELECTORS.chatInput)
  const queryBar = document.querySelector(GROK_SELECTORS.queryBar)

  function addScope(scope: Element | null | undefined): void {
    if (!scope || scopes.includes(scope)) return
    scopes.push(scope)
  }

  addScope(chatInput)
  addScope(queryBar)
  addScope(chatInput?.closest('form'))
  addScope(queryBar?.closest('form'))
  addScope(document.body)
  return scopes
}

function isUsableGrokEditor(editor: Element | null | undefined): editor is HTMLElement {
  if (!(editor instanceof HTMLElement)) return false
  if (editor.hasAttribute('hidden')) return false
  if (editor.getAttribute('aria-hidden') === 'true') return false
  if (editor.getAttribute('tabindex') === '-1') return false
  if (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement) {
    if (editor.disabled || editor.readOnly) return false
  }
  if (!isVisibleInteractiveElement(editor)) return false
  const contentEditable = editor.isContentEditable || editor.getAttribute('contenteditable') === 'true'
  return contentEditable || editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement
}

function countCapacityErrors(): number {
  const body = document.body
  if (!body) return 0
  const text = body.innerText || body.textContent || ''
  return (text.match(new RegExp(CAPACITY_LIMITED_PATTERN.source, 'gi')) ?? []).length
}

function countConnectionErrors(): number {
  const body = document.body
  if (!body) return 0
  const text = body.innerText || body.textContent || ''
  return (text.match(new RegExp(CONNECTION_BLOCKED_PATTERN.source, 'gi')) ?? []).length
}

/**
 * Grok streams answers over a WebSocket. Inside an embedded frame the browser (or the network) can
 * block that socket, which Grok renders as "无法开始对话 / 网络正在阻止 Grok". Without this the prompt
 * looks submitted and the reply simply never arrives, surfacing only as a generic timeout.
 */
async function throwIfGrokConnectionBlocked(errorsBefore: number, timeoutMs: number): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    if (countCapacityErrors() > 0) {
      recordSendFailure('grok', { details: { stage: 'capacity-limited', errorsBefore } })
      throw new Error('Grok 当前使用人数较多，站点提示“需求量高，请稍后再试”。请稍等几分钟后点击“重新回复”，或升级 Grok 订阅后再试')
    }
    if (countConnectionErrors() > errorsBefore) {
      recordSendFailure('grok', { details: { stage: 'connection-blocked', errorsBefore } })
      throw new Error(
        'Grok 无法建立实时连接：页面提示“网络正在阻止 Grok / WebSocket 连接失败”。请在该角色页面里点“重新开始”后重试；若反复失败，说明这个嵌入页面被浏览器的第三方存储策略限制，请在浏览器标签页里直接使用 grok.com，或把该角色换成其他站点。',
      )
    }
    if (isGrokGenerating()) return
    await waitForNextGrokPoll()
  }
}

function collectSendFailureDetails(editor: HTMLElement): Record<string, unknown> {
  return {
    stage: 'dispatch',
    sameEditorInDom: editor.isConnected,
    composerScopes: grokComposerScopes(editor).map(scope => `<${scope.tagName.toLowerCase()} ${scope.className?.toString().slice(0, 40) ?? ''}>`),
    sendButtonMatches: describeSamples(document.querySelectorAll(GROK_SELECTORS.sendButton)),
    editorScopeButtons: describeSamples((editor.closest(GROK_SELECTORS.queryBar) ?? document.body).querySelectorAll('button')),
    proseMirrorMatches: describeSamples(document.querySelectorAll(GROK_SELECTORS.proseMirrorEditor), 4),
    userMessageCount: document.querySelectorAll(GROK_SELECTORS.userMessage).length,
  }
}

function collectPromptDiagnostics(): Record<string, unknown> {
  const editorCandidates = [...document.querySelectorAll<HTMLElement>(GROK_SELECTORS.fallbackEditor)]
  const queryBar = document.querySelector(GROK_SELECTORS.queryBar)
  return {
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    title: document.title,
    editorMatches: editorCandidates.slice(0, 8).map(describeElement),
    proseMirrorMatches: [...document.querySelectorAll(GROK_SELECTORS.proseMirrorEditor)].slice(0, 5).map(describeElement),
    visibleEditorMatches: editorCandidates.filter(isUsableGrokEditor).slice(0, 5).map(describeElement),
    hiddenEditorSamples: [...document.querySelectorAll('textarea[aria-hidden="true"], textarea[tabindex="-1"]')].slice(0, 3).map(describeElement),
    sendButtonMatches: [...document.querySelectorAll(GROK_SELECTORS.sendButton)].slice(0, 5).map(describeElement),
    queryBarButtonSamples: queryBar ? [...queryBar.querySelectorAll('button')].slice(0, 8).map(describeElement) : [],
    visibleButtonSamples: [...document.querySelectorAll('button')].slice(0, 12).map(describeElement),
  }
}

function extractCleanText(node: Node): string {
  return extractCleanTextFromDom(node, { skipTags: SKIP_TAGS })
}

function findResponseContainer(element: Element | null): Element | null {
  const response = findClosestMatchingAncestor(element, GROK_SELECTORS.response)
  return response && isLikelyAssistantResponse(response) ? response : null
}

async function readResponseTextFromCopy(node: Node, timeoutMs: number, pollMs: number): Promise<string | undefined> {
  return readResponseTextFromCopyAction({ node, timeoutMs, pollMs, findCopyButton })
}

function findCopyButton(response: Element): HTMLButtonElement | undefined {
  return findClickableCopyButton(response.closest(GROK_SELECTORS.response) ?? response.parentElement, GROK_SELECTORS.copyButton)
}

function isLikelyAssistantResponse(element: Element): boolean {
  if (element.closest('form, textarea, [contenteditable="true"]')) return false
  if (element.matches('[data-testid="user-message"], [data-message-author-role="user"], [data-author="user"]')) return false
  return extractCleanText(element).length > 0
}

function isGrokGenerating(): boolean {
  return Boolean(findGrokStopButton() || [...document.querySelectorAll(GROK_SELECTORS.activityIndicator)].find(isVisibleInteractiveElement))
}

async function stopGrokGenerating(): Promise<boolean> {
  const button = findGrokStopButton()
  if (!button) return false
  button.click()
  return true
}

function findGrokStopButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonLabelMatches(button, /stop|stopping|停止|中止/i) && isClickableButton(button) && isVisibleInteractiveElement(button))
}

function isVisibleInteractiveElement(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false
  if (element.hasAttribute('hidden')) return false
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false
  if (/\bjsdom\b/i.test(window.navigator.userAgent)) return true
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function waitForNextGrokPoll(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 50))
}
