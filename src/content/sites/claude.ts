import type { ChatSiteAdapter, ConversationSnapshot, SiteStatusInfo } from './types'
import { keepDeepestResponseContainers } from '../responseContainers'
import { findClickableCopyButton, readResponseTextFromCopyAction } from './clipboardCopy'
import { readEditorText, setContentEditableText, submitEditorWithKeyboard, waitForPromptDispatch } from './contentEditable'
import { extractMarkdownFromDom } from './domMarkdown'
import { buttonLabelMatches, describeElement, extractCleanTextFromDom, findClosestMatchingAncestor } from './domText'
import { isClickableButton, isElementVisible, waitForElement } from './waitForElement'

const CLAUDE_HOSTS = new Set(['claude.ai'])
const DEFAULT_INPUT_TIMEOUT_MS = 9000
const DEFAULT_SEND_BUTTON_TIMEOUT_MS = 5000
const DEFAULT_CLIPBOARD_TIMEOUT_MS = 900
const DEFAULT_CLIPBOARD_POLL_MS = 40
const NON_SEND_BUTTON_LABEL_PATTERN = /添加|附件|上传|attach|模型|model|听写|dictat|语音|voice|stop|停止|分享|share|search|搜索/i
const HUMAN_VERIFICATION_TEXT_PATTERN = /正在进行安全验证|请验证您是真人|Verify you are human|Checking your browser/i

const CLAUDE_SELECTORS = {
  editor:
    '[data-testid="chat-input"][contenteditable="true"], div[contenteditable="true"][role="textbox"], div[contenteditable="true"][aria-label*="Claude"], div[contenteditable="true"][aria-label*="提示词"]',
  sendButton:
    'button[data-testid="chat-input-send"], button[aria-label="Send message"], button[aria-label*="Send"], button[aria-label*="发送"], button[aria-label*="Submit"], button[type="submit"]',
  // Current Claude UI marks each reply with data-testid="assistant-message" and streams through
  // data-is-streaming. The reply text lives in the nested [data-cds="Prose"] node; the outer element
  // also holds a screen-reader heading, the action toolbar and a relative <time>, which must not leak
  // into the reply. .font-claude-response is kept for older transcripts.
  response: '[data-testid="assistant-message"] [data-cds="Prose"], [data-testid="assistant-message"], .font-claude-response',
  copyButton:
    'button[data-testid="action-bar-copy"], [data-testid="message-actions"] button[aria-label="复制"], [data-testid="message-actions"] button[aria-label="Copy"], button[aria-label="Copy"], button[aria-label="复制"]',
  blocker: '[role="dialog"], .cookie-banner, [aria-label*="Cookie"], [aria-label*="Consent"]',
  loginOverlay: 'div[role="dialog"] button[aria-label*="Sign in"], div[role="dialog"] button[aria-label*="登录"]',
  humanVerification: 'iframe[src*="challenges.cloudflare.com"], iframe[title*="Cloudflare"], [id*="challenge-page"]',
}

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'BUTTON', 'TEXTAREA', 'SVG'])

interface ClaudeAdapterOptions {
  href?: string
  inputTimeoutMs?: number
  clipboardTimeoutMs?: number
  clipboardPollMs?: number
}

export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): ChatSiteAdapter {
  const inputTimeoutMs = options.inputTimeoutMs ?? DEFAULT_INPUT_TIMEOUT_MS
  const clipboardTimeoutMs = options.clipboardTimeoutMs ?? DEFAULT_CLIPBOARD_TIMEOUT_MS
  const clipboardPollMs = options.clipboardPollMs ?? DEFAULT_CLIPBOARD_POLL_MS

  function currentHref(): string {
    return options.href ?? location.href
  }

  function getConversationSnapshot(): ConversationSnapshot {
    return getClaudeConversationLocation(currentHref())
  }

  function getConversationId(): string {
    return getConversationSnapshot().conversationId || '__default__'
  }

  function getResponseContainers(): Element[] {
    // The reply node ([data-cds="Prose"]) is nested inside [data-testid="assistant-message"]; keeping
    // only the deepest match avoids counting (and concatenating) each reply twice.
    return keepDeepestResponseContainers([...document.querySelectorAll(CLAUDE_SELECTORS.response)])
  }

  function getAllAssistantReplies(): string[] {
    return keepDeepestResponseContainers(getResponseContainers()).map(container => extractCleanText(container)).filter(Boolean)
  }

  async function fillAndSend(content: string, autoSend = true): Promise<void> {
    const editor = await waitForClaudeEditor(inputTimeoutMs)

    setContentEditableText(editor, content)
    if (readEditorText(editor, { normalizeNbsp: true }) !== content.trim()) {
      throw new Error('Claude 输入框没有接收提示词（页面可能仍在加载），请在页面上手动确认后重试')
    }

    if (!autoSend) return

    const promptDispatched = () => isClaudeGenerating()
    const sendButton = await waitForClaudeSendButton(editor, Math.min(inputTimeoutMs, DEFAULT_SEND_BUTTON_TIMEOUT_MS))

    if (sendButton) {
      sendButton.click()
      if (!(await waitForPromptDispatch({ editor, isDispatched: promptDispatched }))) submitEditorWithKeyboard(editor)
      return
    }

    submitEditorWithKeyboard(editor)
    if (await waitForPromptDispatch({ editor, isDispatched: promptDispatched })) return

    throw new Error('Claude 发送失败：页面里没有可用的发送按钮，回车提交也没有生效，请手动发送一次后点击"重新同步完整回复"')
  }

  return {
    id: 'claude',
    getConversationSnapshot,
    getConversationId,
    getResponseContainers,
    getAllAssistantReplies,
    readResponseText: extractCleanText,
    readResponseTextFromCopy: node => readResponseTextFromCopy(node, clipboardTimeoutMs, clipboardPollMs),
    readResponseMarkdown: extractMarkdownFromDom,
    findResponseContainer,
    isGenerating: isClaudeGenerating,
    checkStatus: checkClaudeStatus,
    stopGenerating: stopClaudeGenerating,
    fillAndSend,
    collectPromptDiagnostics,
  }
}

export function getClaudeConversationLocation(href: string): ConversationSnapshot {
  const url = parseSafeClaudeUrl(href)
  if (!url) return {}

  return {
    conversationId: extractConversationId(url),
    conversationUrl: url.href,
  }
}

function parseSafeClaudeUrl(value: string | undefined): URL | undefined {
  if (!value) return undefined

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && CLAUDE_HOSTS.has(url.hostname) ? url : undefined
  } catch {
    return undefined
  }
}

function extractConversationId(url: URL): string | undefined {
  if (!url.pathname.startsWith('/chat/')) return undefined

  const conversationId = url.pathname.slice('/chat/'.length).split('/')[0]
  return conversationId ? decodeURIComponent(conversationId) : undefined
}

function collectPromptDiagnostics(): Record<string, unknown> {
  return {
    href: location.href,
    readyState: document.readyState,
    visibilityState: document.visibilityState,
    title: document.title,
    humanVerification: isClaudeHumanVerificationPending(),
    editorMatches: [...document.querySelectorAll(CLAUDE_SELECTORS.editor)].slice(0, 5).map(describeElement),
    visibleEditorMatches: [...document.querySelectorAll(CLAUDE_SELECTORS.editor)].filter(isElementVisible).slice(0, 5).map(describeElement),
    sendButtonMatches: [...document.querySelectorAll(CLAUDE_SELECTORS.sendButton)].slice(0, 5).map(describeElement),
    visibleButtonSamples: [...document.querySelectorAll('button')].slice(0, 12).map(describeElement),
  }
}

function extractCleanText(node: Node): string {
  return extractCleanTextFromDom(node, { skipTags: SKIP_TAGS })
}

function findResponseContainer(element: Element | null): Element | null {
  return findClosestMatchingAncestor(element, CLAUDE_SELECTORS.response)
}

async function readResponseTextFromCopy(node: Node, timeoutMs: number, pollMs: number): Promise<string | undefined> {
  return readResponseTextFromCopyAction({ node, timeoutMs, pollMs, findCopyButton })
}

function findCopyButton(response: Element): HTMLButtonElement | undefined {
  let scope: Element | null = response
  while (scope && scope !== document.body) {
    const copyButton = findClickableCopyButton(scope, CLAUDE_SELECTORS.copyButton)
    if (copyButton) return copyButton
    scope = scope.parentElement
  }

  return findClickableCopyButton(document.body, CLAUDE_SELECTORS.copyButton)
}

function isClaudeGenerating(): boolean {
  if (document.querySelector('[data-is-streaming="true"], [data-perf-row-streaming="true"]')) return true
  return Boolean(findClaudeStopButton())
}

async function stopClaudeGenerating(): Promise<boolean> {
  const button = findClaudeStopButton()
  if (!button) return false
  button.click()
  return true
}

function findClaudeStopButton(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => buttonLabelMatches(button, /stop|stopping|停止|中止/) && isClickableButton(button))
}

/**
 * Claude inside a narrow iframe is frequently held behind a Cloudflare human check, which hides the
 * composer entirely. Surface that instead of a bare "Element not found".
 */
async function waitForClaudeEditor(timeoutMs: number): Promise<HTMLElement> {
  try {
    return await waitForElement(CLAUDE_SELECTORS.editor, timeoutMs)
  } catch (error) {
    if (isClaudeHumanVerificationPending()) {
      throw new Error('Claude 需要先完成人机验证：请在该角色的页面里点一下并完成 Cloudflare 验证，然后再点"重新回复"')
    }
    throw error
  }
}

function isClaudeHumanVerificationPending(): boolean {
  if (document.querySelector(CLAUDE_SELECTORS.humanVerification)) return true
  if (document.querySelector(CLAUDE_SELECTORS.editor)) return false
  const bodyText = document.body?.innerText ?? ''
  return HUMAN_VERIFICATION_TEXT_PATTERN.test(bodyText)
}

async function waitForClaudeSendButton(editor: HTMLElement, timeoutMs: number): Promise<HTMLElement | undefined> {
  const startedAt = Date.now()

  while (Date.now() - startedAt <= timeoutMs) {
    const button = findClaudeSendButton(editor)
    if (button) return button
    await new Promise(resolve => window.setTimeout(resolve, 100))
  }

  return undefined
}

function findClaudeSendButton(editor: HTMLElement): HTMLElement | undefined {
  const scopes = [
    editor.closest('fieldset'),
    editor.closest('[data-testid*="composer"]'),
    editor.parentElement?.parentElement,
    editor.parentElement,
    document.body,
  ].filter((scope): scope is Element => Boolean(scope))

  for (const scope of scopes) {
    const button = [...scope.querySelectorAll<HTMLElement>(CLAUDE_SELECTORS.sendButton)].find(
      candidate => isClickableButton(candidate) && isElementVisible(candidate) && !isNonSendButton(candidate),
    )
    if (button) return button
  }

  return undefined
}

function isNonSendButton(button: HTMLElement): boolean {
  // Only explicit labels: icon buttons have no text, while the send button often renders "Voice"-like
  // glyph text that must not be mistaken for a feature label.
  const label = [button.getAttribute('aria-label'), button.getAttribute('data-testid'), button.getAttribute('title')]
    .filter(Boolean)
    .join(' ')
  return NON_SEND_BUTTON_LABEL_PATTERN.test(label)
}

function checkClaudeStatus(): SiteStatusInfo {
  const timestamp = Date.now()

  if (location.pathname.includes('/login') || location.pathname.includes('/auth')) {
    return { status: 'unauthorized', detail: 'Session expired, please login', timestamp }
  }

  if (!document.querySelector(CLAUDE_SELECTORS.editor) && isClaudeHumanVerificationPending()) {
    return { status: 'blocked', detail: 'Claude 正在等待人机验证（Cloudflare），请在页面内完成验证', timestamp }
  }

  const editorExists = !!document.querySelector(CLAUDE_SELECTORS.editor)
  const blockerExists = !!document.querySelector(CLAUDE_SELECTORS.blocker)

  if (!editorExists && blockerExists) {
    return { status: 'blocked', detail: 'Cookie banner or overlay blocking access', timestamp }
  }

  if (document.querySelector(CLAUDE_SELECTORS.loginOverlay)) {
    return { status: 'unauthorized', detail: 'Login required', timestamp }
  }

  if (isClaudeGenerating()) {
    return { status: 'generating', detail: 'Claude is thinking...', timestamp }
  }

  return { status: 'ready', timestamp }
}
