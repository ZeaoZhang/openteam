import { describe, expect, it } from 'vitest'
import type { GroupMessage, MessageAttachmentDraft } from '../group/types'
import type { ImageAttachmentBlobRecord } from '../shared/imageAttachmentRepository'
import { attachmentDraftsFromMessage, formatFileSize, loadUserAttachments, parseAttachmentDrafts } from './userAttachments'

function recordFor(id: string, blob: Blob, fileName: string, mimeType: string): ImageAttachmentBlobRecord {
  return { id, chatId: 'chat-1', messageId: 'msg-1', blob, mimeType, size: blob.size, fileName, createdAt: 0 }
}

describe('user attachment drafts', () => {
  it('keeps valid drafts and caps a message at ten attachments', () => {
    const drafts = Array.from({ length: 12 }, (_, index) => ({
      id: `att-${index}`,
      kind: index % 2 === 0 ? 'image' : 'text',
      fileName: `file-${index}.txt`,
      mimeType: 'text/plain',
      size: 12,
    }))

    expect(parseAttachmentDrafts(drafts)).toHaveLength(10)
    expect(parseAttachmentDrafts([{ id: '', fileName: 'x' }, { id: 'a', fileName: 'b', kind: 'video' }])).toEqual([])
    expect(parseAttachmentDrafts('nope')).toEqual([])
  })
})

describe('loadUserAttachments', () => {
  const textDraft: MessageAttachmentDraft = {
    id: 'att-text',
    kind: 'text',
    fileName: 'notes.md',
    mimeType: 'text/markdown',
    size: 11,
  }
  const imageDraft: MessageAttachmentDraft = {
    id: 'att-image',
    kind: 'image',
    fileName: 'photo.png',
    mimeType: 'image/png',
    size: 4,
  }

  it('inlines text files and builds descriptors for uploadable files', async () => {
    const records = new Map<string, ImageAttachmentBlobRecord>([
      [textDraft.id, recordFor(textDraft.id, new Blob(['# 标题\n正文'], { type: 'text/markdown' }), 'notes.md', 'text/markdown')],
      [imageDraft.id, recordFor(imageDraft.id, new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' }), 'photo.png', 'image/png')],
    ])

    const loaded = await loadUserAttachments([textDraft, imageDraft], { get: async id => records.get(id), put: async () => undefined })

    expect(loaded.attachments).toHaveLength(2)
    expect(loaded.attachments[0]).toMatchObject({ type: 'file', kind: 'text', status: 'ready' })
    expect(loaded.attachmentContext).toContain('【附件：notes.md】')
    expect(loaded.attachmentContext).toContain('# 标题')
    expect(loaded.attachmentContext).toContain('【附件：photo.png（image/png')
    expect(loaded.uploads).toEqual([
      {
        id: imageDraft.id,
        kind: 'image',
        fileName: 'photo.png',
        mimeType: 'image/png',
        size: imageDraft.size,
        dataBase64: btoa(String.fromCharCode(1, 2, 3, 4)),
      },
    ])
  })

  it('still records attachments when the blob is missing', async () => {
    const loaded = await loadUserAttachments([imageDraft], { get: async () => undefined, put: async () => undefined })

    expect(loaded.attachments).toHaveLength(1)
    expect(loaded.uploads).toEqual([])
    expect(loaded.attachmentContext).toContain('【附件：photo.png（image/png')
  })

  it('round-trips a stored message back to drafts for retries', () => {
    const message = {
      attachments: [
        { id: 'img', type: 'image', status: 'ready', fileName: 'a.png', mimeType: 'image/png', size: 2 },
        { id: 'doc', type: 'file', status: 'ready', kind: 'document', fileName: 'a.pdf', mimeType: 'application/pdf', size: 3 },
      ],
    } as GroupMessage

    expect(attachmentDraftsFromMessage(message)).toEqual([
      { id: 'img', kind: 'image', fileName: 'a.png', mimeType: 'image/png', size: 2 },
      { id: 'doc', kind: 'document', fileName: 'a.pdf', mimeType: 'application/pdf', size: 3 },
    ])
  })

  it('formats sizes for display', () => {
    expect(formatFileSize(0)).toBe('0 B')
    expect(formatFileSize(900)).toBe('900 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})
