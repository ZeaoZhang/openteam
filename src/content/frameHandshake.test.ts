// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoleToBackgroundMessage } from '../group/runtimeProtocol'
import { registerHostedRoleAttach, registerFrameRoleHandshake } from './frameHandshake'
import type { RoleSession } from './roleSession'
import type { ChatSiteAdapter } from './sites/types'

describe('content role handshake', () => {
  let messageListener: ((message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => unknown) | undefined
  let windowListener: ((event: MessageEvent) => void) | undefined

  beforeEach(() => {
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: vi.fn((listener: (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => unknown) => {
            messageListener = listener
          }),
        },
      },
    })
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener) => {
      if (type === 'message') windowListener = listener as (event: MessageEvent) => void
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    messageListener = undefined
    windowListener = undefined
  })

  it('resolves the hosted role of a tab through the background lookup', async () => {
    const sendRuntimeMessage = vi.fn(async (message: RoleToBackgroundMessage) => {
      if (message.type === 'TEAM_HOSTED_ROLE_LOOKUP') return { ok: true, assignment: { chatId: 'chat-1', roleId: 'role-1', hostTabId: 7 } }
      if (message.type === 'TEAM_FRAME_ROLE_READY') return { ok: true, role: { id: 'role-1', name: '工程师', chatId: 'chat-1' }, replyHistory: ['旧回复'] }
      return { ok: true }
    })
    const assignRole = vi.fn()
    const seedStoredRoleReplies = vi.fn()

    registerHostedRoleAttach({
      ...createDeps(sendRuntimeMessage, assignRole, seedStoredRoleReplies),
      lookupAttempts: 0,
    })
    await vi.waitFor(() => expect(sendRuntimeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'TEAM_FRAME_ROLE_READY', chatId: 'chat-1', roleId: 'role-1' })))

    expect(seedStoredRoleReplies).toHaveBeenCalledWith(['旧回复'])
    expect(assignRole).toHaveBeenCalledWith({ chatId: 'chat-1', roleId: 'role-1', roleName: '工程师', roomId: 'chat-1' })
  })

  it('attaches when the background pushes a TEAM_ATTACH_ROLE message', async () => {
    const sendRuntimeMessage = vi.fn(async (_message: RoleToBackgroundMessage) => ({
      ok: true,
      role: { id: 'role-2', name: '资料研究员', chatId: 'chat-2' },
    }))

    registerHostedRoleAttach({
      ...createDeps(sendRuntimeMessage, vi.fn(), vi.fn()),
      lookupAttempts: 0,
    })

    expect(messageListener).toBeTypeOf('function')
    messageListener?.({ type: 'TEAM_ATTACH_ROLE', chatId: 'chat-2', roleId: 'role-2' }, {}, vi.fn())
    await vi.waitFor(() => expect(sendRuntimeMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'TEAM_FRAME_ROLE_READY', roleId: 'role-2' })))
  })

  it('keeps the iframe postMessage handshake working', async () => {
    const sendRuntimeMessage = vi.fn(async (_message: RoleToBackgroundMessage) => ({
      ok: true,
      role: { id: 'role-3', name: '增长顾问', chatId: 'chat-3' },
    }))
    const assignRole = vi.fn()

    registerFrameRoleHandshake(createDeps(sendRuntimeMessage, assignRole, vi.fn()))
    windowListener?.({ data: { type: 'OPENTEAM_ASSIGN_FRAME_ROLE', chatId: 'chat-3', roleId: 'role-3', hostTabId: 11 } } as MessageEvent)
    await vi.waitFor(() => expect(assignRole).toHaveBeenCalledWith({ chatId: 'chat-3', roleId: 'role-3', roleName: '增长顾问', roomId: 'chat-3' }))
  })
})

function createDeps(
  sendRuntimeMessage: (message: RoleToBackgroundMessage) => Promise<unknown>,
  assignRole: ReturnType<typeof vi.fn>,
  seedStoredRoleReplies: ReturnType<typeof vi.fn>,
) {
  return {
    siteAdapter: {
      getConversationSnapshot: () => ({ conversationId: 'conv-1', conversationUrl: 'https://chatgpt.com/c/conv-1' }),
      getConversationId: () => 'conv-1',
    } as unknown as ChatSiteAdapter,
    roleSession: { assignRole } as unknown as RoleSession,
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    seedStoredRoleReplies,
    sendRuntimeMessage: <T>(message: RoleToBackgroundMessage): Promise<T> => sendRuntimeMessage(message) as Promise<T>,
  }
}
