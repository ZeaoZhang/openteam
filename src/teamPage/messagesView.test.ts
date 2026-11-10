// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GroupChat, GroupMessage, GroupRole, OpenTeamStore } from '../group/types'
import { createDefaultStore } from '../group/store'
import { createTeamPageState } from './appState'
import { THINKING_TIMEOUT_MS } from './chatExperience'
import { createMessagesView } from './messagesView'

afterEach(() => {
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function settleMarkMenuTimer(): void {
  vi.advanceTimersByTime(90)
}

describe('team page messages view boundary', () => {
  it('keeps message rendering and message actions outside the team page entrypoint', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.ts'), 'utf8')
    const viewSource = readFileSync(resolve(process.cwd(), 'src/teamPage/messagesView.ts'), 'utf8')

    expect(viewSource).toContain('function renderMessages(): void')
    expect(viewSource).toContain('function renderMessageNode(message: GroupMessage')
    expect(viewSource).toContain('function renderMarkdownMessageBody(body: HTMLElement, content: string)')
    expect(viewSource).toContain("createMessageIconButton('跳转到原始窗口'")
    expect(viewSource).toContain('showCopyFeedback(button)')
    expect(viewSource).toContain('function scheduleThinkingTimeouts(): void')
    expect(entrySource).not.toContain('function renderMessages(): void')
    expect(entrySource).not.toContain('function renderMessageNode(message: GroupMessage')
    expect(entrySource).not.toContain('function renderMarkdownMessageBody(body: HTMLElement, content: string)')
    expect(entrySource).not.toContain('function scheduleThinkingTimeouts(): void')
  })

  it('keeps the image download action pinned inside the image tile', () => {
    const css = readFileSync(resolve(process.cwd(), 'public/team.css'), 'utf8')
    const selectorIndex = css.indexOf('.message-image-download.message-tool-btn')
    expect(selectorIndex).toBeGreaterThan(-1)

    const rule = css.slice(selectorIndex, css.indexOf('}', selectorIndex))
    expect(rule).toContain('position: absolute')
    expect(rule).toContain('right: 8px')
    expect(rule).toContain('bottom: 8px')
  })

  it('does not mark a role as failed from the UI when a thinking bubble expires', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: [],
      nextMessageSeq: 1,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'thinking',
      contextCursor: 0,
      lastPromptMessageId: 'msg-1',
      createdAt: now,
      updatedAt: now - THINKING_TIMEOUT_MS,
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
    }
    const runCommand = vi.fn(async () => undefined)

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl: document.createElement('section'),
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand,
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(runCommand).not.toHaveBeenCalled()
  })

  it('renders assistant markdown even when older replies do not have a content format flag', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '这是 **重点** 内容',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.querySelector('.markdown-body strong')?.textContent).toBe('重点')
  })

  it('renders pure image replies as an adaptive grid with preview, download, and failure states', async () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-image'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      chatSite: 'chatgpt',
      name: '视觉设计师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-image',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '',
      roleId: role.id,
      roleName: role.name,
      attachments: [
        {
          id: 'attachment-ready',
          type: 'image',
          status: 'ready',
          alt: '已生成图片：产品草图',
          width: 1024,
          height: 1024,
          mimeType: 'image/png',
          size: 5,
          fileName: 'chatgpt-image-1.png',
        },
        {
          id: 'attachment-error',
          type: 'image',
          status: 'error',
          error: '图片获取失败',
        },
      ],
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    document.body.append(messagesEl)
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const createObjectURL = vi.fn(() => 'blob:openteam-image')
    const revokeObjectURL = vi.fn()
    const NativeURL = URL
    class MockURL extends NativeURL {
      static createObjectURL = createObjectURL
      static revokeObjectURL = revokeObjectURL
    }
    vi.stubGlobal('URL', MockURL)

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '视',
      messageTitle: currentMessage => currentMessage.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      loadImageAttachment: vi.fn(async () => ({
        id: 'attachment-ready',
        chatId: chat.id,
        messageId: message.id,
        blob: new Blob(['image'], { type: 'image/png' }),
        mimeType: 'image/png',
        size: 5,
        fileName: 'chatgpt-image-1.png',
        createdAt: now,
      })),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const grid = messagesEl.querySelector('.message-image-grid.image-count-2')
    expect(grid).not.toBeNull()
    await vi.waitFor(() => {
      expect(grid?.querySelector('img')?.getAttribute('src')).toBe('blob:openteam-image')
    })
    expect(grid?.querySelector('.message-image-error')?.textContent).toContain('图片获取失败')
    expect(messagesEl.querySelector('.message-body')).toBeNull()
    expect(messagesEl.querySelector('[aria-label="复制回复"]')).toBeNull()
    expect(messagesEl.querySelector('[aria-label="引用回复"]')).toBeNull()
    expect(messagesEl.querySelector('[aria-label="下载图片"]')).not.toBeNull()

    const preview = messagesEl.querySelector<HTMLButtonElement>('[aria-label="预览图片"]')
    preview?.click()
    expect(open).toHaveBeenCalledWith('blob:openteam-image', '_blank', 'noopener')
  })

  it('renders assistant html table fragments as visible markdown tables', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '<table><thead><tr><th>模型</th><th>结论</th></tr></thead><tbody><tr><td>Claude</td><td>可行</td></tr></tbody></table>',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: currentMessage => currentMessage.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const table = messagesEl.querySelector('.markdown-body table')
    expect(table).not.toBeNull()
    expect(table?.textContent).toContain('模型')
    expect(table?.textContent).toContain('Claude')
    expect(table?.textContent).toContain('可行')
  })

  it('renders assistant math html fragments as visible text instead of blank output', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '<math><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></math>',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: currentMessage => currentMessage.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.querySelector('.markdown-body')?.textContent?.replace(/\s+/g, '')).toContain('E=mc2')
  })

  it('renders a direct iframe jump icon beside assistant site badges', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      chatSite: 'deepseek',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '可以这样做',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    const focusRoleFrame = vi.fn()
    const insertMention = vi.fn()

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame,
      insertMention,
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const jump = messagesEl.querySelector<HTMLButtonElement>('.message-name .message-site-jump-btn')
    expect(messagesEl.querySelector('.role-site-badge')?.textContent).toBe('DeepSeek')
    expect(jump?.getAttribute('aria-label')).toBe('跳转到原始窗口')

    jump?.click()

    expect(focusRoleFrame).toHaveBeenCalledWith(chat.id, role.id)
    expect(insertMention).not.toHaveBeenCalled()
  })

  it('shows configured external model names in assistant badges and user mentions', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-user', 'msg-assistant'],
      nextMessageSeq: 3,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '弗兰克尔',
      modelSource: 'external',
      externalModelId: 'model-1',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const userMessage: GroupMessage = {
      id: 'msg-user',
      chatId: chat.id,
      seq: 1,
      type: 'user',
      content: '你能做什么',
      targetRoleIds: [role.id],
      mentionedRoleIds: [role.id],
      createdAt: now,
      status: 'received',
    }
    const assistantMessage: GroupMessage = {
      id: 'msg-assistant',
      chatId: chat.id,
      seq: 2,
      type: 'assistant',
      content: '你好',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [userMessage.id]: userMessage, [assistantMessage.id]: assistantMessage },
    }
    store.settings.externalModelOrder = ['model-1']
    store.settings.externalModelsById = {
      'model-1': {
        id: 'model-1',
        name: 'OpenRouter Claude',
        format: 'openai',
        baseUrl: 'https://api.example.test/v1',
        apiKey: 'sk-test',
        modelName: 'anthropic/claude-sonnet',
        createdAt: now,
        updatedAt: now,
      },
    }
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [userMessage, assistantMessage],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '弗',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.querySelector('.message-mention')?.textContent).toBe('@弗兰克尔（OpenRouter Claude）')
    expect(messagesEl.querySelector('.role-site-badge')?.textContent).toBe('OpenRouter Claude')
  })

  it('shows all-members mentions on user messages', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-user'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      chatSite: 'deepseek',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const userMessage: GroupMessage = {
      id: 'msg-user',
      chatId: chat.id,
      seq: 1,
      type: 'user',
      content: '一起看一下',
      targetRoleIds: [role.id],
      mentionsAll: true,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [userMessage.id]: userMessage },
    }
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [userMessage],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.querySelector('.message-mention')?.textContent).toBe('@所有人')
    expect(messagesEl.querySelector('.message-body')?.textContent).toContain('一起看一下')
  })

  it('uses API-specific actions for completed external model replies', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-assistant'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '弗兰克尔',
      modelSource: 'external',
      externalModelId: 'model-1',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-assistant',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: 'API 回复',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    const retryRoleReply = vi.fn(async () => undefined)

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '弗',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply,
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.querySelector('[aria-label="跳转到原始窗口"]')).toBeNull()
    expect(messagesEl.querySelector('[aria-label="重新同步完整回复"]')).toBeNull()
    const retryButton = messagesEl.querySelector<HTMLButtonElement>('[aria-label="重新回复"]')
    expect(retryButton).not.toBeNull()
    retryButton?.click()
    expect(retryRoleReply).toHaveBeenCalledWith(role, message.id)
  })

  it('renders retry controls for failed site assistant replies', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-assistant'],
      nextMessageSeq: 2,
      status: 'error',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'error',
      chatSite: 'gemini',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-assistant',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '回复超时了。\n\n可以点击下方的重新回复按钮再试一次。',
      contentFormat: 'markdown',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'error',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    const retryRoleReply = vi.fn(async () => undefined)

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply,
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const retryButton = messagesEl.querySelector<HTMLButtonElement>('.message-tools [aria-label="重新回复"]')
    expect(retryButton).not.toBeNull()
    expect(messagesEl.querySelector('.message-tools [aria-label="重新同步完整回复"]')).toBeNull()
    retryButton?.click()
    expect(retryRoleReply).toHaveBeenCalledWith(role, message.id)
  })

  it('stops a streaming external reply on pointer down before stream renders can replace the button', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-assistant'],
      nextMessageSeq: 2,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '产品经理',
      modelSource: 'external',
      externalModelId: 'model-1',
      status: 'thinking',
      contextCursor: 0,
      lastPromptMessageId: 'msg-user',
      replyAttemptId: 'attempt-1',
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-assistant',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '已经流式返回的内容',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'pending',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    const stopRoleReply = vi.fn(async () => undefined)

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '产',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply,
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const stopButton = messagesEl.querySelector<HTMLButtonElement>('[aria-label="停止回复"]')
    stopButton?.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))

    expect(stopRoleReply).toHaveBeenCalledWith(role)
  })

  it('keeps the streaming stop button stable while assistant content updates', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-assistant'],
      nextMessageSeq: 2,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '产品经理',
      modelSource: 'external',
      externalModelId: 'model-1',
      status: 'thinking',
      contextCursor: 0,
      lastPromptMessageId: 'msg-user',
      replyAttemptId: 'attempt-1',
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-assistant',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '第一段',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'pending',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    const view = createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '产',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    })

    view.renderMessages()
    const firstButton = messagesEl.querySelector<HTMLButtonElement>('[aria-label="停止回复"]')
    message.content = '第一段第二段'
    view.renderMessages()

    expect(messagesEl.querySelector<HTMLButtonElement>('[aria-label="停止回复"]')).toBe(firstButton)
    expect(messagesEl.querySelector('.message-body')?.textContent).toContain('第一段第二段')
  })

  it('requests a full reply resync for the current assistant message without retrying the prompt', async () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '不完整回复',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    const resyncMessageReply = vi.fn(async () => undefined)
    const showSuccess = vi.fn()
    const log = { warn: vi.fn() }

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply,
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess,
      log,
    }).renderMessages()

    messagesEl.querySelector<HTMLButtonElement>('button[aria-label="重新同步完整回复"]')?.click()

    expect(resyncMessageReply).toHaveBeenCalledWith(message)
    await resyncMessageReply.mock.results[0]?.value
    await new Promise(resolve => window.setTimeout(resolve, 0))
    expect(showSuccess).toHaveBeenCalledWith('执行成功了')
    expect(log.warn).toHaveBeenCalledWith('ui:message-resync:click', {
      chatId: chat.id,
      roleId: role.id,
      messageId: message.id,
      contentLength: message.content.length,
    })
  })

  it('preserves message scroll once after a reply resync render', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '同步后的完整回复',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const state = createTeamPageState()
    state.preserveNextMessageScroll = true
    const messagesEl = document.createElement('section')
    messagesEl.scrollTop = 120
    Object.defineProperty(messagesEl, 'scrollHeight', { configurable: true, value: 960 })

    createMessagesView({
      state,
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.scrollTop).toBe(120)
    expect(state.preserveNextMessageScroll).toBe(true)
  })

  it('preserves message scroll across push and command renders during reply resync', async () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '不完整回复',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const state = createTeamPageState()
    const messagesEl = document.createElement('section')
    Object.defineProperty(messagesEl, 'scrollHeight', { configurable: true, value: 960 })
    let finishResync: (() => void) | undefined
    const resyncMessageReply = vi.fn(() => new Promise<void>(resolve => {
      finishResync = resolve
    }))

    const view = createMessagesView({
      state,
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply,
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    })

    view.renderMessages()
    messagesEl.scrollTop = 120
    messagesEl.querySelector<HTMLButtonElement>('button[aria-label="重新同步完整回复"]')?.click()

    view.renderMessages()
    expect(messagesEl.scrollTop).toBe(120)
    expect(state.preserveNextMessageScroll).toBe(true)

    view.renderMessages()
    expect(messagesEl.scrollTop).toBe(120)

    finishResync?.()
    await resyncMessageReply.mock.results[0]?.value
    await new Promise(resolve => window.setTimeout(resolve, 0))

    expect(state.preserveNextMessageScroll).toBe(false)
  })

  it('keeps the current reading position when new replies render away from the bottom', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1', 'msg-2'],
      nextMessageSeq: 3,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const messages: GroupMessage[] = [
      {
        id: 'msg-1',
        chatId: chat.id,
        seq: 1,
        type: 'user',
        content: '请分析这个方案',
        createdAt: now,
        status: 'sent',
      },
      {
        id: 'msg-2',
        chatId: chat.id,
        seq: 2,
        type: 'assistant',
        content: '后续人员的新回复',
        roleId: role.id,
        roleName: role.name,
        createdAt: now + 1,
        status: 'received',
      },
    ]
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: Object.fromEntries(messages.map(message => [message.id, message])),
    }
    const messagesEl = document.createElement('section')
    messagesEl.scrollTop = 120
    Object.defineProperty(messagesEl, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(messagesEl, 'scrollHeight', { configurable: true, value: 1000 })

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => messages,
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.scrollTop).toBe(120)
  })

  it('continues following new replies when the reader is already near the bottom', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '最新回复',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    messagesEl.scrollTop = 680
    Object.defineProperty(messagesEl, 'clientHeight', { configurable: true, value: 300 })
    Object.defineProperty(messagesEl, 'scrollHeight', { configurable: true, value: 1000 })

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.scrollTop).toBe(1000)
  })

  it('renders saved message highlights without changing the message text', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '这里有一段重点内容',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
      messageHighlightsById: {
        [message.id]: [
          {
            id: 'highlight-1',
            messageId: message.id,
            text: '重点',
            startOffset: 5,
            endOffset: 7,
            createdAt: now,
          },
        ],
      },
    }
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.textContent).toContain(message.content)
    expect(messagesEl.querySelector('.message-highlight')?.textContent).toBe('重点')
  })

  it('renders saved message highlights with their selected color', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: [],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '这里有一段重点内容',
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      messagesById: { [message.id]: message },
      messageHighlightsById: {
        [message.id]: [
          {
            id: 'highlight-1',
            messageId: message.id,
            text: '重点',
            startOffset: 5,
            endOffset: 7,
            color: '#7dd3fc',
            createdAt: now,
          },
        ],
      },
    }
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.querySelector<HTMLElement>('.message-highlight')?.style.getPropertyValue('--message-highlight-rgb')).toBe('125, 211, 252')
  })

  it('offers selected message text actions that can highlight and add to notes', async () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '工程师',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '这里有一段重点内容',
      roleId: role.id,
      roleName: role.name,
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    document.body.append(messagesEl)
    const runCommand = vi.fn(async () => undefined)
    const insertTextIntoActiveNote = vi.fn()

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      insertTextIntoActiveNote,
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand,
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const bodyText = messagesEl.querySelector('.message-body')?.firstChild?.firstChild
    expect(bodyText?.textContent).toContain('重点')
    const range = document.createRange()
    range.setStart(bodyText as Text, 5)
    range.setEnd(bodyText as Text, 7)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    vi.useFakeTimers()
    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    settleMarkMenuTimer()
    document.querySelector<HTMLButtonElement>('button[aria-label="高亮并加入笔记"]')?.click()
    await Promise.resolve()

    expect(insertTextIntoActiveNote).toHaveBeenCalledWith('重点')
    expect(runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_HIGHLIGHT_CREATE', {
      chatId: chat.id,
      messageId: message.id,
      text: '重点',
      startOffset: 5,
      endOffset: 7,
      color: '#f8b84e',
    })
  })

  it('shows the mark menu from selection changes and applies the selected highlight color', async () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: [],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '这里有一段重点内容',
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    document.body.append(messagesEl)
    const runCommand = vi.fn(async () => undefined)

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand,
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const bodyText = messagesEl.querySelector('.message-body')?.firstChild?.firstChild
    const range = document.createRange()
    range.setStart(bodyText as Text, 5)
    range.setEnd(bodyText as Text, 7)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    vi.useFakeTimers()
    document.dispatchEvent(new Event('selectionchange'))
    settleMarkMenuTimer()
    document.querySelector<HTMLButtonElement>('button[aria-label="高亮颜色：蓝色"]')?.click()
    document.querySelector<HTMLButtonElement>('button[aria-label="高亮"]')?.click()
    await Promise.resolve()

    expect(runCommand).toHaveBeenCalledWith('GROUP_MESSAGE_HIGHLIGHT_CREATE', {
      chatId: chat.id,
      messageId: message.id,
      text: '重点',
      startOffset: 5,
      endOffset: 7,
      color: '#7dd3fc',
    })
  })

  it('waits until drag selection ends before showing the mark menu', async () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: [],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '这里有一段重点内容',
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    document.body.append(messagesEl)

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const bodyText = messagesEl.querySelector('.message-body')?.firstChild?.firstChild
    const range = document.createRange()
    range.setStart(bodyText as Text, 5)
    range.setEnd(bodyText as Text, 7)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    vi.useFakeTimers()
    messagesEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.dispatchEvent(new Event('selectionchange'))
    expect(document.querySelector('.mark-menu')).toBeNull()

    messagesEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    settleMarkMenuTimer()
    expect(document.querySelector('.mark-menu')).not.toBeNull()
  })

  it('keeps the pending mark menu when the drag-ending click lands outside the message body', async () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: [],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '这里有一段重点内容',
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    const outsideEl = document.createElement('div')
    document.body.append(messagesEl, outsideEl)

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const bodyText = messagesEl.querySelector('.message-body')?.firstChild?.firstChild
    const range = document.createRange()
    range.setStart(bodyText as Text, 5)
    range.setEnd(bodyText as Text, 7)
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    vi.useFakeTimers()
    messagesEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    document.dispatchEvent(new Event('selectionchange'))
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    outsideEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    settleMarkMenuTimer()

    expect(document.querySelector('.mark-menu')).not.toBeNull()
  })

  it('positions the mark menu well above the selected text', async () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: [],
      messageIds: ['msg-1'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-1',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '这里有一段重点内容',
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      messagesById: { [message.id]: message },
    }
    const messagesEl = document.createElement('section')
    document.body.append(messagesEl)

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    const bodyText = messagesEl.querySelector('.message-body')?.firstChild?.firstChild
    const range = document.createRange()
    range.setStart(bodyText as Text, 5)
    range.setEnd(bodyText as Text, 7)
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 120,
        y: 180,
        left: 120,
        top: 180,
        right: 168,
        bottom: 200,
        width: 48,
        height: 20,
        toJSON: () => ({}),
      } as DOMRect),
    })
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    vi.useFakeTimers()
    document.dispatchEvent(new Event('selectionchange'))
    settleMarkMenuTimer()

    expect(document.querySelector<HTMLElement>('.mark-menu')?.style.top).toBe('20px')
  })

  it('renders orchestration metadata labels and review summaries', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-review'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = {
      id: 'role-1',
      chatId: chat.id,
      name: '复核员',
      status: 'ready',
      contextCursor: 0,
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-review',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '复核结果',
      roleId: role.id,
      roleName: role.name,
      orchestrationRunId: 'run-1',
      orchestrationRound: 1,
      orchestrationStageId: 'stage-2',
      orchestrationStageIndex: 1,
      orchestrationKind: 'review',
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
      orchestrationRunsById: {
        'run-1': {
          id: 'run-1',
          chatId: chat.id,
          flowId: 'flow-1',
          status: 'completed',
          currentRound: 1,
          maxRounds: 2,
          stageRuns: [
            {
              stageId: 'stage-2',
              stageIndex: 1,
              kind: 'review',
              round: 1,
              status: 'completed',
              roleRuns: { [role.id]: { roleId: role.id, status: 'completed', messageId: message.id } },
              reviewResults: [
                {
                  round: 1,
                  stageRunId: 'stage-2',
                  reviewerRoleId: role.id,
                  messageId: message.id,
                  decision: 'fail',
                  reason: '还需要补充测试',
                  failedCriteria: ['测试不足'],
                  nextRoundInstruction: '下一轮补齐测试',
                  rawJson: '{}',
                  createdAt: now,
                },
              ],
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      },
    }
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '复',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.querySelector('.orchestration-message-label')?.textContent).toBe('编排 · 第 2 步 · 复核')
    expect(messagesEl.querySelector('.orchestration-review-summary')?.textContent).toContain('决策：不通过')
    expect(messagesEl.querySelector('.orchestration-review-summary')?.textContent).toContain('原因：还需要补充测试')
    expect(messagesEl.querySelector('.orchestration-review-summary')?.textContent).toContain('未通过：测试不足')
    expect(messagesEl.querySelector('.orchestration-review-summary')?.textContent).toContain('重试说明：下一轮补齐测试')
  })

  it('renders debate verdict summaries for judge messages', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: ['role-1'],
      messageIds: ['msg-judge'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const role: GroupRole = { id: 'role-1', chatId: chat.id, name: '裁判', status: 'ready', contextCursor: 0, createdAt: now, updatedAt: now }
    const message: GroupMessage = {
      id: 'msg-judge',
      chatId: chat.id,
      seq: 1,
      type: 'assistant',
      content: '{"decision":"conclude"}',
      roleId: role.id,
      roleName: role.name,
      orchestrationRunId: 'run-1',
      orchestrationRound: 2,
      orchestrationStageId: 'stage-debate',
      orchestrationStageIndex: 3,
      orchestrationKind: 'judge',
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      rolesById: { [role.id]: role },
      messagesById: { [message.id]: message },
      orchestrationRunsById: {
        'run-1': {
          id: 'run-1',
          chatId: chat.id,
          flowId: 'flow-1',
          status: 'completed',
          currentRound: 2,
          maxRounds: 2,
          stageRuns: [
            {
              stageId: 'stage-debate',
              stageIndex: 3,
              kind: 'debate',
              round: 2,
              status: 'completed',
              roleRuns: { [role.id]: { roleId: role.id, status: 'completed', messageId: message.id } },
              debate: { side: 'judge', round: 2, roleId: role.id },
              debateVerdict: {
                round: 2,
                decision: 'conclude',
                winner: 'pro',
                reason: '正方回应了成本质疑',
                nextRoundInstruction: '',
                finalRecommendation: '带成本上限推进',
                messageId: message.id,
                createdAt: now,
              },
            },
          ],
          createdAt: now,
          updatedAt: now,
        },
      },
    }
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [role],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '裁',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.querySelector('.orchestration-message-label')?.textContent).toBe('编排 · 第 4 步 · 裁判')
    const summary = messagesEl.querySelector('.orchestration-debate-summary')
    expect(summary?.textContent).toContain('结论：收敛')
    expect(summary?.textContent).toContain('胜方：正方')
    expect(summary?.textContent).toContain('原因：正方回应了成本质疑')
    expect(summary?.textContent).toContain('最终建议：带成本上限推进')
  })

  it('invalidates cached message nodes when orchestration metadata changes', () => {
    const now = Date.now()
    const chat: GroupChat = {
      id: 'chat-1',
      name: '群聊',
      mode: 'independent',
      roleIds: [],
      messageIds: ['msg-status'],
      nextMessageSeq: 2,
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    }
    const message: GroupMessage = {
      id: 'msg-status',
      chatId: chat.id,
      seq: 1,
      type: 'system',
      content: '状态更新',
      orchestrationRunId: 'run-1',
      orchestrationRound: 1,
      orchestrationStageIndex: 0,
      orchestrationKind: 'status',
      createdAt: now,
      status: 'received',
    }
    const store: OpenTeamStore = {
      ...createDefaultStore(),
      currentChatId: chat.id,
      chatOrder: [chat.id],
      chatsById: { [chat.id]: chat },
      messagesById: { [message.id]: message },
    }
    const state = createTeamPageState()
    const messagesEl = document.createElement('section')
    const view = createMessagesView({
      state,
      getStore: () => store,
      messagesEl,
      getCurrentChat: () => chat,
      getCurrentRoles: () => [],
      getCurrentMessages: () => [message],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    })

    view.renderMessages()
    expect(messagesEl.querySelector('.orchestration-message-label')?.textContent).toBe('编排 · 第 1 步 · 状态')
    message.orchestrationStageIndex = 1
    view.renderMessages()

    expect(messagesEl.querySelector('.orchestration-message-label')?.textContent).toBe('编排 · 第 2 步 · 状态')
  })

  it('shows a first-run welcome panel whose buttons start a chat or open the people library', () => {
    const openCreateChat = vi.fn()
    const openPeopleLibrary = vi.fn()
    const messagesEl = document.createElement('section')

    createMessagesView({
      state: createTeamPageState(),
      getStore: () => createDefaultStore(),
      messagesEl,
      getCurrentChat: () => undefined,
      getCurrentRoles: () => [],
      getCurrentMessages: () => [],
      emptyCard: () => document.createElement('div'),
      openAddPersonDialog: vi.fn(),
      openCreateChat,
      openPeopleLibrary,
      roleToneClass: () => 'role-tone-1',
      roleAvatarLabel: () => '工',
      messageTitle: message => message.roleName ?? 'AI 人员',
      focusRoleFrame: vi.fn(),
      insertMention: vi.fn(),
      setReference: vi.fn(),
      resyncMessageReply: vi.fn(async () => undefined),
      retryRoleReply: vi.fn(async () => undefined),
      stopRoleReply: vi.fn(async () => undefined),
      runCommand: vi.fn(async () => undefined),
      render: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
      log: { warn: vi.fn() },
    }).renderMessages()

    expect(messagesEl.querySelector('.welcome-card h3')?.textContent).toBe('先新建或选择一个群聊')
    expect(messagesEl.querySelectorAll('.welcome-steps li')).toHaveLength(3)

    const [createButton, libraryButton] = [...messagesEl.querySelectorAll<HTMLButtonElement>('.welcome-card .empty-actions button')]
    expect(createButton.textContent).toBe('新建群聊')
    expect(libraryButton.textContent).toBe('浏览人员库')
    createButton.click()
    libraryButton.click()
    expect(openCreateChat).toHaveBeenCalledTimes(1)
    expect(openPeopleLibrary).toHaveBeenCalledTimes(1)
  })
})
