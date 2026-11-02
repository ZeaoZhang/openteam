// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../group/store'
import type { GroupChat, GroupRole } from '../group/types'
import { createTeamPageState } from './appState'
import { createComposerView, type ComposerViewDependencies } from './composerView'

describe('team page composer view boundary', () => {
  it('keeps composer rendering, references, mentions, and send flow outside the entrypoint', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.ts'), 'utf8')
    const viewSource = readFileSync(resolve(process.cwd(), 'src/teamPage/composerView.ts'), 'utf8')

    expect(viewSource).toContain('function renderComposerState(): void')
    expect(viewSource).toContain('function renderReferenceDraft(): void')
    expect(viewSource).toContain('function renderMentionPanel(): void')
    expect(viewSource).toContain('function submitComposerMessage(): Promise<void>')
    expect(viewSource).toContain('function setReference(message: GroupMessage): void')
    expect(viewSource).toContain('function shouldShowMentionPanel(value: string): boolean')
    expect(viewSource).toContain('function insertMention(role: GroupRole): void')
    expect(viewSource).toContain('function registerComposerEvents(): void')
    expect(entrySource).not.toContain('function renderComposerState(): void')
    expect(entrySource).not.toContain('function renderReferenceDraft(): void')
    expect(entrySource).not.toContain('function renderMentionPanel(): void')
    expect(entrySource).not.toContain('function submitComposerMessage(): Promise<void>')
    expect(entrySource).not.toContain('function setReference(message: GroupMessage): void')
    expect(entrySource).not.toContain('function shouldShowMentionPanel(value: string): boolean')
    expect(entrySource).not.toContain('function insertMention(role: GroupRole): void')
  })
})

describe('team page composer targeting', () => {
  it('offers an all-members mention option when the mention panel opens', () => {
    const { view, deps } = createComposerHarness()
    deps.messageInputEl.value = '@'

    view.renderComposerState()

    const options = [...deps.mentionPanelEl.querySelectorAll<HTMLButtonElement>('.mention-option')]
    expect(deps.mentionPanelEl.hidden).toBe(false)
    expect(options.map(option => option.querySelector('.mention-name')?.textContent)).toEqual(['所有人', '工程师'])
    expect(options.map(option => option.querySelector('.mention-site-badge')?.textContent)).toEqual(['全员', 'DeepSeek'])

    options[0].click()

    expect(deps.messageInputEl.value).toBe('@所有人 ')
    deps.messageInputEl.value = '@所有人 请一起看'
    view.renderComposerState()
    expect(deps.targetPreviewEl.textContent).toBe('将发送给：工程师（DeepSeek）')
  })

  it('sends an attachment-only message with file metadata', async () => {
    const { view, deps, runCommand } = createComposerHarness()
    view.registerComposerEvents()
    const file = new File(['hello'], 'note.txt', { type: 'text/plain' })
    Object.defineProperty(deps.attachmentInputEl, 'files', { value: [file], configurable: true })

    deps.attachmentInputEl.dispatchEvent(new Event('change'))
    await vi.waitFor(() => expect(deps.state.pendingComposerAttachments).toHaveLength(1))

    await view.submitComposerMessage()

    expect(runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_SEND', {
      chatId: 'chat-1',
      raw: '',
      reference: undefined,
      attachments: [{ id: expect.any(String), kind: 'text', fileName: 'note.txt', mimeType: 'text/plain', size: 5 }],
    })
    expect(deps.state.pendingComposerAttachments).toHaveLength(0)
  })

  it('confirms the default all-members mention with Enter from the keyboard', () => {
    const { view, deps, runCommand } = createComposerHarness()
    view.registerComposerEvents()
    deps.messageInputEl.value = '@'
    deps.messageInputEl.setSelectionRange(1, 1)

    const event = pressKey(deps.messageInputEl, 'Enter')

    expect(event.defaultPrevented).toBe(true)
    expect(deps.messageInputEl.value).toBe('@所有人 ')
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('moves mention selection with arrow keys before confirming a role', () => {
    const { view, deps } = createComposerHarness({
      roles: [
        makeRole('chat-1', 'role-1', '工程师', 'ready'),
        makeRole('chat-1', 'role-2', '产品经理', 'ready'),
      ],
    })
    view.registerComposerEvents()
    deps.messageInputEl.value = '@'
    deps.messageInputEl.setSelectionRange(1, 1)

    const downEvent = pressKey(deps.messageInputEl, 'ArrowDown')

    expect(downEvent.defaultPrevented).toBe(true)
    expect(deps.state.mentionIndex).toBe(1)
    expect(deps.mentionPanelEl.hidden).toBe(false)
    expect(activeMentionName(deps.mentionPanelEl)).toBe('工程师')

    const upEvent = pressKey(deps.messageInputEl, 'ArrowUp')

    expect(upEvent.defaultPrevented).toBe(true)
    expect(deps.state.mentionIndex).toBe(0)
    expect(activeMentionName(deps.mentionPanelEl)).toBe('所有人')

    pressKey(deps.messageInputEl, 'ArrowDown')
    pressKey(deps.messageInputEl, 'Enter')

    expect(deps.messageInputEl.value).toBe('@工程师（DeepSeek） ')
  })

  it('previews no-mention messages as chat records without requiring ready roles', () => {
    const { view, deps } = createComposerHarness({ roleStatus: 'thinking', requireManualMention: true })
    deps.messageInputEl.value = '先记录这个背景'

    view.renderComposerState()

    expect(deps.targetPreviewEl.textContent).toBe('将作为群消息记录，不触发 AI；@ 人员可触发回复')
    expect(deps.sendButtonEl.disabled).toBe(false)
  })

  it('previews no-mention collaborative messages as chat records by default', () => {
    const { view, deps } = createComposerHarness({ mode: 'collaborative' })
    deps.messageInputEl.value = '先记录这个背景'

    view.renderComposerState()

    expect(deps.targetPreviewEl.textContent).toBe('将作为群消息记录，不触发 AI；@ 人员可触发回复')
    expect(deps.sendButtonEl.disabled).toBe(false)
  })

  it('previews no-mention collaborative messages as all-member replies when manual mention routing is off', () => {
    const { view, deps } = createComposerHarness({ mode: 'collaborative', requireManualMention: false })
    deps.messageInputEl.value = '请一起评估'

    view.renderComposerState()

    expect(deps.targetPreviewEl.textContent).toBe('将发送给：工程师（DeepSeek）')
    expect(deps.sendButtonEl.disabled).toBe(false)
  })

  it('submits no-mention messages without reconnecting or blocking on thinking roles', async () => {
    const { view, deps, runCommand, reconnectRolesForSend, showError } = createComposerHarness({ roleStatus: 'thinking', requireManualMention: true })
    deps.messageInputEl.value = '先记录这个背景'

    await view.submitComposerMessage()

    expect(showError).not.toHaveBeenCalled()
    expect(reconnectRolesForSend).not.toHaveBeenCalled()
    expect(runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_SEND', {
      chatId: 'chat-1',
      raw: '先记录这个背景',
      reference: undefined,
      attachments: [],
    })
  })

  it('submits all-member messages when at least one targeted role can receive them', async () => {
    const { view, deps, runCommand, reconnectRolesForSend, showError } = createComposerHarness({
      roles: [
        makeRole('chat-1', 'role-1', '工程师', 'ready'),
        makeRole('chat-1', 'role-2', '产品经理', 'thinking', Date.now()),
      ],
    })
    deps.messageInputEl.value = '@all 请一起评估'

    await view.submitComposerMessage()

    expect(showError).not.toHaveBeenCalled()
    expect(reconnectRolesForSend).not.toHaveBeenCalled()
    expect(runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_SEND', {
      chatId: 'chat-1',
      raw: '@all 请一起评估',
      reference: undefined,
      attachments: [],
    })
  })
})

function createComposerHarness(options: { roleStatus?: GroupRole['status']; roles?: GroupRole[]; mode?: GroupChat['mode']; requireManualMention?: boolean } = {}) {
  const store = createDefaultStore()
  const roles = options.roles ?? [makeRole('chat-1', 'role-1', '工程师', options.roleStatus ?? 'ready')]
  const chat: GroupChat = {
    id: 'chat-1',
    name: '讨论',
    mode: options.mode ?? 'independent',
    roleIds: roles.map(role => role.id),
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    requireManualMention: options.requireManualMention,
    createdAt: 0,
    updatedAt: 0,
  }
  store.currentChatId = chat.id
  store.chatOrder = [chat.id]
  store.chatsById[chat.id] = chat
  for (const role of roles) store.rolesById[role.id] = role

  const state = createTeamPageState()
  state.store = store
  const runCommand = vi.fn(async () => undefined)
  const reconnectRolesForSend = vi.fn(async () => undefined)
  const showError = vi.fn()
  const mentionPanelEl = document.createElement('div')
  mentionPanelEl.hidden = true
  const deps: ComposerViewDependencies = {
    state,
    composerFormEl: document.createElement('form'),
    targetPreviewEl: document.createElement('div'),
    busyPreviewEl: document.createElement('div'),
    sendButtonEl: document.createElement('button'),
    messageInputEl: document.createElement('textarea'),
    attachFileButtonEl: document.createElement('button'),
    attachmentInputEl: document.createElement('input'),
    attachmentDraftEl: document.createElement('div'),
    attachmentRepository: {
      put: vi.fn(async () => undefined),
      get: vi.fn(async () => undefined),
      deleteByIds: vi.fn(async () => undefined),
      deleteByMessageIds: vi.fn(async () => undefined),
      deleteByChatId: vi.fn(async () => undefined),
      deleteOrphans: vi.fn(async () => undefined),
    },
    referenceDraftEl: document.createElement('div'),
    mentionPanelEl,
    getStore: () => store,
    getCurrentChat: () => chat,
    getCurrentRoles: () => roles,
    roleToneClass: () => 'tone-test',
    roleAvatarLabel: () => '工',
    reconnectRolesForSend,
    runCommand,
    showError,
  }

  return {
    view: createComposerView(deps),
    deps,
    runCommand,
    reconnectRolesForSend,
    showError,
  }
}

function makeRole(chatId: string, id: string, name: string, status: GroupRole['status'], updatedAt = 0): GroupRole {
  return {
    id,
    chatId,
    name,
    systemPrompt: `从${name}角度分析`,
    status,
    contextCursor: 0,
    createdAt: 0,
    updatedAt,
  }
}

function pressKey(target: HTMLElement, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

function activeMentionName(panel: HTMLElement): string | undefined {
  return panel.querySelector('.mention-option.active .mention-name')?.textContent ?? undefined
}
