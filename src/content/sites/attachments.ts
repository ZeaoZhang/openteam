import type { PromptAttachmentPayload } from '../../group/types'

const UPLOAD_INPUT_TIMEOUT_MS = 5_000
const UPLOAD_PREVIEW_TIMEOUT_MS = 20_000
const UPLOAD_SETTLE_MS = 800
const POLL_MS = 150

export interface PromptAttachmentUploadConfig {
  inputSelectors: string[]
  /** Buttons that mount the site's hidden file inputs (clicked only when no input exists). */
  openButtonSelectors?: string[]
  previewSelectors: string[]
}

/**
 * Sends files through a site's own hidden `<input type=file>`.
 *
 * Sites check the trusted-ness of drag/drop and paste events, so injecting those does not
 * work. Assigning `input.files` from a `DataTransfer` and dispatching `change` does trigger
 * the site's real upload pipeline (verified against Gemini).
 */
export async function uploadPromptAttachments(
  attachments: PromptAttachmentPayload[],
  config: PromptAttachmentUploadConfig,
): Promise<void> {
  if (attachments.length === 0) return

  const inputs = await ensureFileInputs(config)
  if (inputs.length === 0) {
    throw new Error('当前 AI 页面没有找到文件上传入口，请先打开上传菜单后重试')
  }

  const previewCountBefore = countMatches(config.previewSelectors)
  const groups = new Map<HTMLInputElement, File[]>()
  let skipped = 0

  for (const attachment of attachments) {
    const file = payloadToFile(attachment)
    const input = inputs.find(candidate => inputAcceptsFile(candidate, file))
    if (!input) {
      skipped += 1
      continue
    }
    const files = groups.get(input) ?? []
    files.push(file)
    groups.set(input, files)
  }

  if (groups.size === 0) {
    throw new Error(skipped > 0 ? '当前 AI 页面不支持这些附件类型' : '没有可上传的附件')
  }

  let fileCount = 0
  for (const [input, files] of groups) {
    fileCount += files.length
    const transfer = new DataTransfer()
    for (const file of files) transfer.items.add(file)
    input.files = transfer.files
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const previewsArrived = await waitForPreviewCount(config.previewSelectors, previewCountBefore + fileCount, UPLOAD_PREVIEW_TIMEOUT_MS)
  if (!previewsArrived) {
    throw new Error('附件上传超时，请检查 AI 页面是否完成上传后重试')
  }
  await sleep(UPLOAD_SETTLE_MS)
}

async function ensureFileInputs(config: PromptAttachmentUploadConfig): Promise<HTMLInputElement[]> {
  const existing = queryFileInputs(config.inputSelectors)
  if (existing.length > 0) return existing

  for (const selector of config.openButtonSelectors ?? []) {
    const button = document.querySelector<HTMLElement>(selector)
    if (!button || button.hasAttribute('disabled')) continue
    button.click()
    const inputs = await waitForFileInputs(config.inputSelectors, UPLOAD_INPUT_TIMEOUT_MS)
    if (inputs.length > 0) return inputs
  }

  return waitForFileInputs(config.inputSelectors, 0)
}

function queryFileInputs(selectors: string[]): HTMLInputElement[] {
  const inputs: HTMLInputElement[] = []
  for (const selector of selectors) {
    for (const input of document.querySelectorAll<HTMLInputElement>(selector)) {
      if (input.type === 'file') inputs.push(input)
    }
  }
  return inputs
}

async function waitForFileInputs(selectors: string[], timeoutMs: number): Promise<HTMLInputElement[]> {
  if (timeoutMs <= 0) return queryFileInputs(selectors)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const inputs = queryFileInputs(selectors)
    if (inputs.length > 0) return inputs
    await sleep(POLL_MS)
  }
  return queryFileInputs(selectors)
}

function inputAcceptsFile(input: HTMLInputElement, file: File): boolean {
  const accept = input.accept?.trim().toLowerCase()
  if (!accept) return true
  const mimeType = file.type.toLowerCase()
  const fileName = file.name.toLowerCase()
  return accept.split(',').some(rawToken => {
    const token = rawToken.trim()
    if (!token) return false
    if (token === '*/*' || token === '*') return true
    if (token.endsWith('/*')) return mimeType.startsWith(token.slice(0, -1))
    if (token.startsWith('.')) return fileName.endsWith(token)
    return mimeType === token
  })
}

function payloadToFile(attachment: PromptAttachmentPayload): File {
  const binary = atob(attachment.dataBase64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new File([bytes], attachment.fileName, { type: attachment.mimeType || 'application/octet-stream' })
}

function countMatches(selectors: string[]): number {
  let count = 0
  for (const selector of selectors) count += document.querySelectorAll(selector).length
  return count
}

async function waitForPreviewCount(selectors: string[], expected: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (countMatches(selectors) >= expected) return true
    await sleep(POLL_MS)
  }
  return countMatches(selectors) >= expected
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, ms))
}
