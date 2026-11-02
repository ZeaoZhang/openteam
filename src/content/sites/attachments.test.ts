// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { uploadPromptAttachments } from './attachments'

class FakeDataTransfer {
  private _files: File[] = []
  readonly items = { add: (file: File) => this._files.push(file) }
  get files(): File[] {
    return this._files
  }
}

function base64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes))
}

const originalFilesDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files')

function allowPlainFileList(): void {
  Object.defineProperty(HTMLInputElement.prototype, 'files', {
    configurable: true,
    get(this: HTMLInputElement & { __files?: File[] }) {
      return this.__files
    },
    set(this: HTMLInputElement & { __files?: File[] }, value: File[]) {
      this.__files = value
    },
  })
}

describe('prompt attachment uploader', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.replaceChildren()
    if (originalFilesDescriptor) Object.defineProperty(HTMLInputElement.prototype, 'files', originalFilesDescriptor)
    else delete (HTMLInputElement.prototype as { files?: unknown }).files
  })

  it('assigns files to an existing hidden input and waits for a preview', async () => {
    vi.stubGlobal('DataTransfer', FakeDataTransfer)
    allowPlainFileList()
    const input = document.createElement('input')
    input.type = 'file'
    const preview = document.createElement('div')
    preview.className = 'preview'
    document.body.append(input, preview)
    const change = vi.fn()
    input.addEventListener('change', () => {
      change()
      const added = document.createElement('div')
      added.className = 'preview'
      document.body.append(added)
    })

    await uploadPromptAttachments([
      { id: 'att-1', kind: 'image', fileName: 'a.png', mimeType: 'image/png', size: 3, dataBase64: base64([1, 2, 3]) },
    ], { inputSelectors: ['input[type="file"]'], previewSelectors: ['.preview'] })

    expect(change).toHaveBeenCalledTimes(1)
    expect(input.files).toHaveLength(1)
    expect(input.files?.[0]?.name).toBe('a.png')
  })

  it('opens the upload menu when no file input is mounted yet', async () => {
    vi.stubGlobal('DataTransfer', FakeDataTransfer)
    allowPlainFileList()
    const button = document.createElement('button')
    button.setAttribute('aria-label', '上传和工具')
    const preview = document.createElement('div')
    preview.className = 'preview'
    document.body.append(button, preview)
    button.addEventListener('click', () => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.addEventListener('change', () => {
        const added = document.createElement('div')
        added.className = 'preview'
        document.body.append(added)
      })
      document.body.append(input)
    })

    await uploadPromptAttachments([
      { id: 'att-2', kind: 'image', fileName: 'b.png', mimeType: 'image/png', size: 3, dataBase64: base64([4, 5, 6]) },
    ], {
      inputSelectors: ['input[type="file"]'],
      openButtonSelectors: ['button[aria-label="上传和工具"]'],
      previewSelectors: ['.preview'],
    })

    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1)
    expect(document.querySelectorAll('.preview')).toHaveLength(2)
  })

  it('rejects files no input accepts', async () => {
    vi.stubGlobal('DataTransfer', FakeDataTransfer)
    allowPlainFileList()
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/png'
    document.body.append(input)

    await expect(uploadPromptAttachments([
      { id: 'att-3', kind: 'document', fileName: 'c.pdf', mimeType: 'application/pdf', size: 3, dataBase64: base64([7, 8, 9]) },
    ], { inputSelectors: ['input[type="file"]'], previewSelectors: ['.preview'] })).rejects.toThrow('当前 AI 页面不支持这些附件类型')
  })
})
