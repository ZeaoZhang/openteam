import { describe, expect, it, vi } from 'vitest'
import { createDefaultStore } from '../group/store'
import type { GroupChat, GroupRole, OpenTeamStore } from '../group/types'
import type { RoleTabHost } from './roleTabHost'

describe('background host mode handlers', () => {
  it('exposes the hosting routes', async () => {
    vi.resetModules()
    const { HOST_MODE_ROUTE_TYPES, createHostModeHandlers } = await import('./hostModeHandlers')
    const routes = createHostModeHandlers(createDeps())

    expect(HOST_MODE_ROUTE_TYPES).toEqual([
      'GROUP_ROLE_HOST_MODE_SET',
      'GROUP_ROLE_HOST_TAB_FOCUS',
      'GROUP_CONNECTION_CHECK',
      'GROUP_HOSTED_ROLES_SYNC',
      'TEAM_HOSTED_ROLE_LOOKUP',
    ])
    expect(routes.map(route => route.type)).toEqual([...HOST_MODE_ROUTE_TYPES])
  })

  it('opens a browser tab when a member switches to tab hosting', async () => {
    const store = makeStore()
    const open = vi.fn(async () => ({ tabId: 99, created: true }))
    const attach = vi.fn(async () => true)
    const broadcastStoreUpdated = vi.fn()
    const handlers = await loadHandlers(store, { roleTabHost: createRoleTabHost({ open, attach }), broadcastStoreUpdated })

    const response = (await handlers.route('GROUP_ROLE_HOST_MODE_SET', {
      type: 'GROUP_ROLE_HOST_MODE_SET',
      chatId: 'chat-1',
      roleId: 'role-1',
      hostMode: 'tab',
    })) as { ok?: boolean; tabId?: number }

    expect(open).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://chatgpt.com/', existingTabId: undefined }))
    expect(store.rolesById['role-1'].hostMode).toBe('tab')
    expect(store.rolesById['role-1'].hostedTabId).toBe(99)
    expect(store.rolesById['role-1'].status).toBe('loading')
    expect(response.ok).toBe(true)
    expect(response.tabId).toBe(99)
    expect(broadcastStoreUpdated).toHaveBeenCalled()
    await vi.waitFor(() => expect(attach).toHaveBeenCalledWith(expect.objectContaining({ type: 'TEAM_ATTACH_ROLE', roleId: 'role-1' }), 99))
  })

  it('closes the hosted tab and drops the binding when switching back to the embedded frame', async () => {
    const store = makeStore()
    store.rolesById['role-1'].hostMode = 'tab'
    store.rolesById['role-1'].hostedTabId = 42
    const close = vi.fn(async () => undefined)
    const removeRole = vi.fn()
    const handlers = await loadHandlers(store, { roleTabHost: createRoleTabHost({ close }), runtimeFrames: createRuntimeFrames({ removeRole }) })

    const response = (await handlers.route('GROUP_ROLE_HOST_MODE_SET', {
      type: 'GROUP_ROLE_HOST_MODE_SET',
      chatId: 'chat-1',
      roleId: 'role-1',
      hostMode: 'iframe',
    })) as { ok?: boolean }

    expect(close).toHaveBeenCalledWith(42)
    expect(removeRole).toHaveBeenCalledWith('chat-1', 'role-1')
    expect(store.rolesById['role-1'].hostMode).toBe('iframe')
    expect(store.rolesById['role-1'].hostedTabId).toBeUndefined()
    expect(response.ok).toBe(true)
  })

  it('resolves the role that owns a hosted tab', async () => {
    const store = makeStore()
    store.rolesById['role-1'].hostMode = 'tab'
    store.rolesById['role-1'].hostedTabId = 77
    const handlers = await loadHandlers(store, {})

    const hit = (await handlers.route('TEAM_HOSTED_ROLE_LOOKUP', { type: 'TEAM_HOSTED_ROLE_LOOKUP', hostTabId: 5 }, { tab: { id: 77 } } as unknown as chrome.runtime.MessageSender)) as {
      ok?: boolean
      assignment?: { chatId?: string; roleId?: string }
    }
    expect(hit.ok).toBe(true)
    expect(hit.assignment).toMatchObject({ chatId: 'chat-1', roleId: 'role-1' })

    const miss = (await handlers.route('TEAM_HOSTED_ROLE_LOOKUP', { type: 'TEAM_HOSTED_ROLE_LOOKUP' }, { tab: { id: 78 } } as unknown as chrome.runtime.MessageSender)) as { ok?: boolean }
    expect(miss.ok).toBe(false)
  })

  it('re-attaches tab-hosted members whose binding was lost', async () => {
    const store = makeStore()
    store.rolesById['role-1'].hostMode = 'tab'
    store.rolesById['role-1'].hostedTabId = 31
    const attach = vi.fn(async () => true)
    const handlers = await loadHandlers(store, {
      roleTabHost: createRoleTabHost({ attach }),
      runtimeFrames: createRuntimeFrames({ getByRole: vi.fn(() => undefined) }),
    })

    const response = (await handlers.route('GROUP_HOSTED_ROLES_SYNC', { type: 'GROUP_HOSTED_ROLES_SYNC', chatId: 'chat-1' }, {
      tab: { id: 9 },
    } as unknown as chrome.runtime.MessageSender)) as { ok?: boolean; data?: { attached?: string[]; missing?: string[] } }

    expect(attach).toHaveBeenCalledWith({ type: 'TEAM_ATTACH_ROLE', chatId: 'chat-1', roleId: 'role-1' }, 31)
    expect(response.data?.attached).toEqual(['role-1'])
    expect(response.data?.missing).toEqual([])
  })

  it('reloads a hosted tab whose content script can no longer answer', async () => {
    const store = makeStore()
    store.rolesById['role-1'].hostMode = 'tab'
    store.rolesById['role-1'].hostedTabId = 31
    const reload = vi.fn(async () => true)
    const handlers = await loadHandlers(store, {
      roleTabHost: createRoleTabHost({ attach: vi.fn(async () => false), reload }),
      runtimeFrames: createRuntimeFrames({ getByRole: vi.fn(() => undefined) }),
    })

    const response = (await handlers.route('GROUP_HOSTED_ROLES_SYNC', { type: 'GROUP_HOSTED_ROLES_SYNC', chatId: 'chat-1' }, {} as chrome.runtime.MessageSender)) as {
      data?: { missing?: string[] }
    }

    expect(reload).toHaveBeenCalledWith(31)
    expect(response.data?.missing).toEqual(['role-1'])
  })

  it('skips the attach when the hosted tab is already bound or gone', async () => {
    const store = makeStore()
    store.rolesById['role-1'].hostMode = 'tab'
    store.rolesById['role-1'].hostedTabId = 31
    const attach = vi.fn(async () => true)
    const bound = await loadHandlers(store, {
      roleTabHost: createRoleTabHost({ attach }),
      runtimeFrames: createRuntimeFrames({ getByRole: vi.fn(() => ({ ready: true })) }),
    })
    await bound.route('GROUP_HOSTED_ROLES_SYNC', { type: 'GROUP_HOSTED_ROLES_SYNC', chatId: 'chat-1' }, {} as chrome.runtime.MessageSender)
    expect(attach).not.toHaveBeenCalled()

    const gone = await loadHandlers(store, {
      roleTabHost: createRoleTabHost({ attach, isAlive: vi.fn(async () => false) }),
      runtimeFrames: createRuntimeFrames({ getByRole: vi.fn(() => undefined) }),
    })
    const response = (await gone.route('GROUP_HOSTED_ROLES_SYNC', { type: 'GROUP_HOSTED_ROLES_SYNC', chatId: 'chat-1' }, {} as chrome.runtime.MessageSender)) as {
      data?: { missing?: string[] }
    }
    expect(attach).not.toHaveBeenCalled()
    expect(response.data?.missing).toEqual(['role-1'])
  })

  it('reports per-member connection state and site capabilities', async () => {
    const store = makeStore()
    store.rolesById['role-1'].hostMode = 'tab'
    store.rolesById['role-1'].hostedTabId = 12
    store.rolesById['role-1'].status = 'ready'
    store.rolesById['role-1'].chatSite = 'grok'
    const isAlive = vi.fn(async () => true)
    const handlers = await loadHandlers(store, {
      roleTabHost: createRoleTabHost({ isAlive }),
      runtimeFrames: createRuntimeFrames({ getByRole: vi.fn(() => ({ chatId: 'chat-1', roleId: 'role-1', tabId: 12, frameId: 0, ready: true, lastSeenAt: 1 })) }),
    })

    const response = (await handlers.route('GROUP_CONNECTION_CHECK', { type: 'GROUP_CONNECTION_CHECK', chatId: 'chat-1' }, {})) as {
      ok?: boolean
      data?: { roles: Array<Record<string, unknown>>; sites: Array<Record<string, unknown>> }
    }

    expect(response.ok).toBe(true)
    expect(response.data?.roles).toHaveLength(1)
    expect(response.data?.roles[0]).toMatchObject({ roleId: 'role-1', hostMode: 'tab', ready: true, tabAlive: true, siteLabel: 'Grok' })
    expect(response.data?.sites.map(site => site.site)).toEqual(['gemini', 'chatgpt', 'claude', 'deepseek', 'grok'])
    expect(response.data?.sites.find(site => site.site === 'grok')).toMatchObject({ embeddable: false })
  })
})

function makeStore(): OpenTeamStore {
  const store = createDefaultStore()
  const chat: GroupChat = {
    id: 'chat-1',
    name: '产品会',
    mode: 'independent',
    roleIds: ['role-1'],
    messageIds: [],
    nextMessageSeq: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
  }
  const role: GroupRole = {
    id: 'role-1',
    chatId: chat.id,
    name: '产品经理',
    status: 'ready',
    contextCursor: 0,
    chatSite: 'chatgpt',
    modelSource: 'site',
    createdAt: 1,
    updatedAt: 1,
  }
  store.currentChatId = chat.id
  store.chatOrder = [chat.id]
  store.chatsById[chat.id] = chat
  store.rolesById[role.id] = role
  return store
}

interface HandlerOverrides {
  broadcastStoreUpdated?: ReturnType<typeof vi.fn>
  roleTabHost?: unknown
  runtimeFrames?: unknown
}

async function loadHandlers(store: OpenTeamStore, overrides: HandlerOverrides) {
  vi.resetModules()
  vi.doMock('./storeAccess', async importOriginal => {
    const actual = await importOriginal<typeof import('./storeAccess')>()
    return {
      ...actual,
      mutateStore: vi.fn(async (mutator: (draft: OpenTeamStore) => unknown) => ({ store, result: await mutator(store) })),
    }
  })
  vi.doMock('../group/store', async importOriginal => {
    const actual = await importOriginal<typeof import('../group/store')>()
    return { ...actual, loadStore: vi.fn(async () => store) }
  })

  const { createHostModeHandlers } = await import('./hostModeHandlers')
  const routes = createHostModeHandlers({
    broadcastStoreUpdated: (overrides.broadcastStoreUpdated ?? vi.fn()) as never,
    log: { info: vi.fn(), warn: vi.fn() },
    now: () => 100,
    roleTabHost: (overrides.roleTabHost ?? createRoleTabHost({})) as never,
    runtimeFrames: (overrides.runtimeFrames ?? createRuntimeFrames({})) as never,
  })

  return {
    routes,
    route(type: string, message: Record<string, unknown>, sender: chrome.runtime.MessageSender = {}) {
      const route = routes.find(candidate => candidate.type === type)
      if (!route) throw new Error(`missing route ${type}`)
      return route.handler({ ...message, type }, sender)
    },
  }
}

function createRoleTabHost(overrides: Partial<RoleTabHost>): RoleTabHost {
  return {
    open: vi.fn(async () => ({ tabId: 1, created: true })),
    focus: vi.fn(async () => true),
    close: vi.fn(async () => undefined),
    isAlive: vi.fn(async () => true),
    attach: vi.fn(async () => true),
    reload: vi.fn(async () => true),
    ...overrides,
  } as RoleTabHost
}

function createRuntimeFrames(overrides: Record<string, unknown>) {
  return {
    getByRole: vi.fn(() => undefined),
    removeRole: vi.fn(),
    ...overrides,
  }
}

function createDeps() {
  return {
    broadcastStoreUpdated: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn() },
    now: () => 100,
    roleTabHost: createRoleTabHost({}),
    runtimeFrames: createRuntimeFrames({}) as never,
  }
}
