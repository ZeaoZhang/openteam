import type { ChatSiteAdapter, ConversationSnapshot } from './types'
import { keepDeepestResponseContainers } from '../responseContainers'
import { clearEditorContent, describeEditorWriteFailure, getLastEditorWriteDiagnostics, getLastEditorWriteStrategy, readEditorText, submitEditorWithKeyboard, waitForPromptDispatch, writeEditorTextWithRetry } from './contentEditable'
import { extractMarkdownFromDom } from './domMarkdown'
import { buttonLabelMatches, describeElement, extractCleanTextFromDom, findClosestMatchingAncestor } from './domText'
import { isClickableButton, waitForElement } from './waitForElement'

const KIMI_HOST = 'www.kimi.com'
const KIMI_ORIGIN = `https://${KIMI_HOST}`
const KIMI_HOME_URL = `${KIMI_ORIGIN}/`
const DEFAULT_INPUT_TIMEOUT_MS = 9000
const DEFAULT_SEND_BUTTON_TIMEOUT_MS = 5000
// Kimi throttles free accounts during peak hours; the site shows a queue upgrade prompt instead of
// answering, which otherwise looks like a silent stall until the reply timeout fires.
const CAPACITY_LIMITED_PATTERN = /聊天的人太多了|进入优先队列|订阅会员|升级会员|too many people/i

const KIMI_SELECTORS = {
  editor:
    'div.chat-input-editor[contenteditable="true"], .chat-input-editor[role="textbox"], [contenteditable="true"][data-lexical-editor="true"], [contenteditable="true"][role="textbox"]',
  composer: '.chat-editor-input-wrap, .chat-input-container, [class*="chat-input"], [class*="editor-container"], form',
  response: '.chat-content-item-assistant',
  // The answer lives in `.markdown-container`; the thinking rollup uses the
  // `.toolcall-content-text` modifier, so excluding it keeps reasoning out of replies.
  responseText:
    '.chat-content-item-assistant .markdown-container:not(.toolcall-content-text) .markdown, .chat-content-item-assistant .markdown-container:not(.toolcall-content-text)',
  userMessage: '.chat-content-item-user',
  sendButton:
    '.send-button-container, button.send-btn, button[class*="send"], [role="button"][class*="send"], button[aria-label*="发送"], button[aria-label*="Send"]',
  stopButton: 'button[aria-label*="停止"], [role="button"][aria-label*="停止"], button.stop-button, [role="button"].stop-button',
  copyButton: '.segment-assistant-actions-content svg[name="Copy"], .segment-assistant-actions .icon-button:first-child',
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'TEXTAREA', 'SVG'])

interface KimiAdapterOptions {
  href?: string
  inputTimeoutMs?: number
}

export function createKimiAdapter(options: KimiAdapterOptions = {}): ChatSiteAdapter {
  const inputTimeoutMs = options.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS

  function currentHref(): string {
    return options.href ?? location.href
  }

  function getConversationSnapshot(): ConversationSnapshot {
    return getKimiConversationLocation(currentHref())
  }

  function getConversationId(): string {
    return getConversationSnapshot().conversationId || '__default__'
  }

  function getResponseContainers(): Element[] {
    const answers = [...document.querySelectorAll(KIMI_SELECTORS.responseText)]
    return answers.length > 0 ? answers : [...document.querySelectorAll(KIMI_SELECTORS.response)]
  }

  function getAllAssistantReplies(): string[] {
    return keepDeepestResponseContainers(getResponseContainers()).map(container => extractCleanText(container)).filter(Boolean)
  }

  async function fillAndSend(content: string, autoSend = true): Promise<void> {
    const editor = await waitForKimiEditor(inputTimeoutMs)
    const messageCountBefore = document.querySelectorAll(KIMI_SELECTORS.userMessage).length

    // Kimi's Lexical composer keeps a server-side draft and only honours real keystrokes for deletion,
    // so a stale draft cannot be replaced from a content script. Refuse to write instead of appending:
    // each append makes the draft bigger until the site stops accepting input.
    if (readEditorText(editor) && !clearEditorContent(editor) && readEditorText(editor)) {
      const leftover = readEditorText(editor).length
      throw new Error(`Kimi 输入框里还有 ${leftover} 个字符的未发送草稿，站点不允许脚本清空。请在该角色页面里点一下输入框，按 Cmd+A 再按 Backspace 清空草稿，然后点击"重新回复"。`)
    }

    if (!(await writeEditorTextWithRetry(editor, content, { allowPaste: false }))) {
      // Leave no prompt behind: Kimi restores unsent drafts, and a stray draft gets duplicated by the
      // next attempt until the composer is too large for the site to clear.
      clearEditorContent(editor)
      throw new Error(`Kimi 输入框没有接收提示词（页面可能仍在加载），请在页面上手动确认后重试${describeEditorWriteFailure(editor)} [${writeSummary(editor)}]`)
    }

    if (!autoSend) return

    const promptDispatched = () =>
      document.querySelectorAll(KIMI_SELECTORS.userMessage).length > messageCountBefore || !readEditorText(editor)

    // Kimi accepts a synthetic Enter even when the page is inside an embedded frame, where clicking the
    // `div.send-button-container` is ignored, so submit with the keyboard first and fall back to the
    // button only if the composer survives.
    submitEditorWithKeyboard(editor)
    if (await waitForPromptDispatch({ editor, isDispatched: promptDispatched })) {
      throwIfKimiCapacityLimited()
      return
    }

    const sendButton = await waitForKimiSendButton(editor, Math.min(inputTimeoutMs, DEFAULT_SEND_BUTTON_TIMEOUT_MS))

    if (sendButton) {
      pressKimiSendButton(sendButton)
      if (!(await waitForPromptDispatch({ editor, isDispatched: promptDispatched }))) {
        pressKimiSendButton(sendButton, true)
      }
      if (await waitForPromptDispatch({ editor, isDispatched: promptDispatched, timeoutMs: 2500 })) {
        throwIfKimiCapacityLimited()
        return
      }
    }

    // Never leave our prompt behind as a draft: the next attempt would append to it and grow the
    // composer until the site refuses to clear it.
    if (!clearEditorContent(editor) && readEditorText(editor)) {
      throw new Error('Kimi 发送失败：页面里没有可用的发送按钮，回车提交也没有生效，且输入框里的提示词无法自动清除，请在该角色页面里手动发送或清空后点击"重新同步完整回复"')
    }
    throw new Error('Kimi 发送失败：页面里没有可用的发送按钮，回车提交也没有生效，请手动发送一次后点击"重新同步完整回复"')
  }

  return {
    id: 'kimi',
    getConversationSnapshot,
    getConversationId,
    getResponseContainers,
    getAllAssistantReplies,
    readResponseText: extractCleanText,
    readResponseMarkdown: extractMarkdownFromDom,
    findResponseContainer,
    isGenerating: isKimiGenerating,
    stopGenerating: stopKimiGenerating,
    fillAndSend,
    collectPromptDiagnostics,
  }
}

export function getKimiConversationLocation(href: string): ConversationSnapshot {
  const url = parseSafeKimiUrl(href)
  if (!url) return {}

  return {
    conversationId: extractConversationId(url),
    conversationUrl: url.href,
  }
}

function parseSafeKimiUrl(value: string | undefined): URL | undefined {
  if (!value || !value.startsWith(KIMI_HOME_URL)) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === KIMI_HOST ? url : undefined
  } catch {
    return undefined
  }
}

function extractConversationId(url: URL): string | undefined {
  const match = url.pathname.match(/^\/chat\/([^/]+)/)
  const conversationId = match?.[1]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

function writeSummary(editor: HTMLElement): string {
  const rect = editor.getBoundingClientRect()
  return `写入=${getLastEditorWriteStrategy() ?? 'none'} ${getLastEditorWriteDiagnostics()} 尺寸=${Math.round(rect.width)}x${Math.round(rect.height)}`
}

async function waitForKimiEditor(timeoutMs: number): Promise<HTMLElement> {
  try {
    return await waitForElement(KIMI_SELECTORS.editor, timeoutMs)
  } catch {
    throw new Error('Kimi 输入框未出现（页面可能仍在加载或登录态失效），请刷新该角色的页面后重试')
  }
}

async function waitForKimiSendButton(editor: HTMLElement, timeoutMs: number): Promise<HTMLElement | undefined> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= timeoutMs) {
    const button = findKimiSendButton(editor)
    if (button) return button
    await new Promise(resolve => window.setTimeout(resolve, 50))
  }

  return undefined
}

function kimiComposerScopes(editor: HTMLElement): Element[] {
  const scopes: Element[] = []
  const add = (element: Element | null | undefined) => {
    if (element && !scopes.includes(element)) scopes.push(element)
  }

  add(editor.closest(KIMI_SELECTORS.composer))
  add(editor.closest('form'))
  add(editor.parentElement?.parentElement?.parentElement)
  add(editor.parentElement)
  add(document.body)

  return scopes
}

function findKimiSendButton(editor: HTMLElement): HTMLElement | undefined {
  for (const scope of kimiComposerScopes(editor)) {
    const candidates = [...scope.querySelectorAll<HTMLElement>(KIMI_SELECTORS.sendButton)]
    const match = candidates.filter(isUsableKimiSendButton).pop()
    if (match) return match
  }

  return undefined
}

function isUsableKimiSendButton(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false
  if (element instanceof HTMLButtonElement && element.disabled) return false
  if (hasDisabledClass(element)) return false
  if (buttonLabelMatches(element, /attach|upload|file|camera|image|voice|microphone|附件|上传|图片|语音|登录|login/i)) return false
  return isVisibleInteractiveElement(element)
}

function hasDisabledClass(element: Element): boolean {
  const className = typeof element.className === 'string' ? element.className : ''
  return /(^|[\s-])(disabled|is-disabled)([\s-]|$)/i.test(className)
}

/**
 * Kimi renders the send control as a plain `div.send-button-container`, so a bare `.click()` is not
 * always enough: replay the pointer sequence the site listens to, then a click.
 */
function pressKimiSendButton(button: HTMLElement, withPointerSequence = false): void {
  const rect = button.getBoundingClientRect()
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    buttons: 1,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
    view: button.ownerDocument.defaultView,
  }

  if (withPointerSequence && typeof PointerEvent === 'function') {
    const pointerInit = { ...init, pointerId: 1, pointerType: 'mouse', isPrimary: true } as PointerEventInit
    button.dispatchEvent(new PointerEvent('pointerdown', pointerInit))
    button.dispatchEvent(new MouseEvent('mousedown', init))
    button.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0 }))
    button.dispatchEvent(new MouseEvent('mouseup', { ...init, buttons: 0 }))
  }

  button.click()
}

function collectPromptDiagnostics(): Record<string, unknown> {
  return {
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    title: document.title,
    editorMatches: [...document.querySelectorAll(KIMI_SELECTORS.editor)].slice(0, 5).map(describeElement),
    sendButtonMatches: [...document.querySelectorAll(KIMI_SELECTORS.sendButton)].slice(0, 5).map(describeElement),
    visibleButtonSamples: [...document.querySelectorAll('[role="button"], button')].slice(0, 12).map(describeElement),
  }
}

function extractCleanText(node: Node): string {
  return extractCleanTextFromDom(node, { skipTags: SKIP_TAGS })
}

function findResponseContainer(element: Element | null): Element | null {
  return findClosestMatchingAncestor(element, KIMI_SELECTORS.response)
}

function isKimiGenerating(): boolean {
  return Boolean(findKimiStopButton())
}

function throwIfKimiCapacityLimited(): void {
  const body = document.body
  if (!body) return
  const text = body.innerText || body.textContent || ''
  if (!CAPACITY_LIMITED_PATTERN.test(text)) return
  throw new Error('Kimi 当前聊天人数较多，站点提示"和 Kimi 聊天的人太多了，订阅会员可进入优先队列"。请稍等几分钟后点击"重新回复"，或升级 Kimi 订阅后再试。')
}

async function stopKimiGenerating(): Promise<boolean> {
  const button = findKimiStopButton()
  if (!button) return false
  button.click()
  return true
}

function findKimiStopButton(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>(KIMI_SELECTORS.stopButton)].find(button =>
    buttonLabelMatches(button, /stop|stopping|停止|中止/) && isClickableKimiElement(button),
  )
}

function isClickableKimiElement(element: HTMLElement): boolean {
  if (element.getAttribute('aria-disabled') === 'true') return false
  if (element instanceof HTMLButtonElement) return isClickableButton(element)
  return isVisibleInteractiveElement(element)
}

function isVisibleInteractiveElement(element: Element): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false
  return true
}
