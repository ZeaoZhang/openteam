import type { ImageAttachmentBlobRecord } from '../shared/imageAttachmentRepository'
import type { GroupMessage, MessageAttachment, MessageAttachmentDraft, PromptAttachmentPayload } from '../group/types'

const MAX_ATTACHMENTS_PER_MESSAGE = 10
const MAX_TEXT_ATTACHMENT_CHARS = 20_000
const MAX_TEXT_CONTEXT_CHARS = 60_000
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_UPLOAD_BYTES = 20 * 1024 * 1024
const BASE64_CHUNK_SIZE = 0x8000

export interface LoadedUserAttachments {
  attachments: MessageAttachment[]
  attachmentContext?: string
  uploads: PromptAttachmentPayload[]
}

export interface UserAttachmentRepository {
  get(id: string): Promise<ImageAttachmentBlobRecord | undefined>
  put(record: ImageAttachmentBlobRecord): Promise<void>
}

export function parseAttachmentDrafts(value: unknown): MessageAttachmentDraft[] {
  if (!Array.isArray(value)) return []
  const drafts: MessageAttachmentDraft[] = []
  for (const item of value) {
    if (drafts.length >= MAX_ATTACHMENTS_PER_MESSAGE) break
    if (!item || typeof item !== 'object') continue
    const candidate = item as Record<string, unknown>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const fileName = typeof candidate.fileName === 'string' ? candidate.fileName.trim() : ''
    const mimeType = typeof candidate.mimeType === 'string' ? candidate.mimeType.trim() : ''
    const kind = candidate.kind
    const size = typeof candidate.size === 'number' && Number.isFinite(candidate.size) ? Math.max(0, candidate.size) : 0
    if (!id || !fileName) continue
    if (kind !== 'image' && kind !== 'text' && kind !== 'document') continue
    drafts.push({ id, kind, fileName, mimeType, size })
  }
  return drafts
}

export async function loadUserAttachments(
  drafts: MessageAttachmentDraft[],
  repository: UserAttachmentRepository | undefined,
  expectedChatId?: string,
): Promise<LoadedUserAttachments> {
  if (drafts.length === 0) return { attachments: [], uploads: [] }
  const acceptedDrafts: MessageAttachmentDraft[] = []
  const contextParts: string[] = []
  const uploads: PromptAttachmentPayload[] = []
  let textBudget = MAX_TEXT_CONTEXT_CHARS
  let uploadBytes = 0

  for (const draft of drafts) {
    const record = repository ? await repository.get(draft.id).catch(() => undefined) : undefined
    if (record && expectedChatId && record.chatId !== expectedChatId) continue
    acceptedDrafts.push(draft)
    if (draft.kind === 'text') {
      const text = record ? await readAttachmentText(record) : undefined
      const available = Math.min(MAX_TEXT_ATTACHMENT_CHARS, Math.max(0, textBudget))
      const clipped = text ? text.slice(0, available) : ''
      if (clipped.trim()) {
        contextParts.push(`【附件：${draft.fileName}】\n${clipped}${text && text.length > clipped.length ? '\n（附件内容已截断）' : ''}`)
        textBudget -= clipped.length
      } else {
        contextParts.push(`【附件：${draft.fileName}（${describeMime(draft)}，未能读取内容）】`)
      }
      continue
    }

    contextParts.push(`【附件：${draft.fileName}（${describeMime(draft)}）】`)
    const blob = record?.blob
    if (!record || !blob || blob.size > MAX_UPLOAD_BYTES) continue
    if (uploadBytes + blob.size > MAX_TOTAL_UPLOAD_BYTES) {
      contextParts.push(`【附件：${draft.fileName}（本条消息附件总量过大，未能上传）】`)
      continue
    }
    uploadBytes += blob.size
    const dataBase64 = await blobToBase64(blob)
    uploads.push({ id: draft.id, kind: draft.kind, fileName: draft.fileName, mimeType: draft.mimeType, size: draft.size, dataBase64 })
  }

  return {
    attachments: acceptedDrafts.map(toMessageAttachment),
    attachmentContext: contextParts.length > 0 ? contextParts.join('\n\n') : undefined,
    uploads,
  }
}

function toMessageAttachment(draft: MessageAttachmentDraft): MessageAttachment {
  if (draft.kind === 'image') {
    return {
      id: draft.id,
      type: 'image',
      status: 'ready',
      fileName: draft.fileName,
      mimeType: draft.mimeType,
      size: draft.size,
    }
  }
  return {
    id: draft.id,
    type: 'file',
    status: 'ready',
    kind: draft.kind,
    fileName: draft.fileName,
    mimeType: draft.mimeType,
    size: draft.size,
  }
}

async function readAttachmentText(record: ImageAttachmentBlobRecord): Promise<string | undefined> {
  try {
    return await record.blob.text()
  } catch {
    return undefined
  }
}

function describeMime(draft: MessageAttachmentDraft): string {
  const type = draft.mimeType || '未知类型'
  return `${type}，${formatFileSize(draft.size)}`
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(index, index + BASE64_CHUNK_SIZE))
  }
  return btoa(binary)
}

export function attachmentDraftsFromMessage(message: GroupMessage): MessageAttachmentDraft[] {
  return (message.attachments ?? []).map(attachment => attachment.type === 'image'
    ? {
        id: attachment.id,
        kind: 'image',
        fileName: attachment.fileName || '图片',
        mimeType: attachment.mimeType || 'image/*',
        size: attachment.size ?? 0,
      }
    : {
        id: attachment.id,
        kind: attachment.kind,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })
}
