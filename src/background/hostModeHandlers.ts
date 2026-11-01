import { CHAT_SITE_LIST, chatSiteLabel, defaultHostModeForSite, isEmbeddableChatSite } from '../group/chatSites'
import { getDefaultChatSiteUrlForRole } from '../group/conversationUrl'
import { loadStore } from '../group/store'
import type { ChatSite, GroupChat, GroupRole, OpenTeamStore } from '../group/types'
import type { BackgroundMessageRoute } from './messageRouter'
import { mutateStore, requireChat, requireRole, getChatRoles } from './storeAccess'
import { messageTabId, rememberHost, type RuntimeMessage } from './runtimeClient'
import type { RuntimeFrameRegistry } from './runtimeFrames'
import type { RoleTabHost } from './roleTabHost'

export const HOST_MODE_ROUTE_TYPES = [
  'GROUP_ROLE_HOST_MODE_SET',
  'GROUP_ROLE_HOST_TAB_FOCUS',
  'GROUP_CONNECTION_CHECK',
  'GROUP_HOSTED_ROLES_SYNC',
  'TEAM_HOSTED_ROLE_LOOKUP',
] as const

export interface HostModeHandlersDependencies {
  broadcastStoreUpdated(store: OpenTeamStore, excludeTabId?: number): Promise<void> | void
  log: {
    info(event: string, details?: Record<string, unknown>): void
    warn(event: string, details?: Record<string, unknown>): void
  }
  now(): number
  roleTabHost: RoleTabHost
  runtimeFrames: Pick<RuntimeFrameRegistry, 'getByRole' | 'removeRole'>
}

export interface SiteCapability {
  site: ChatSite
  label: string
  embeddable: boolean
  note: string
}

export interface RoleConnectionReport {
  roleId: string
  name: string
  site?: ChatSite
  siteLabel: string
  hostMode: 'iframe' | 'tab'
  inTeamPage: boolean
  tabId?: number
  tabAlive: boolean
  ready: boolean
  status: RoleStatusLabel
  detail?: string
}

type RoleStatusLabel = GroupRole['status']

export interface ConnectionReport {
  chatId: string
  chatName: string
  roles: RoleConnectionReport[]
  sites: SiteCapability[]
}

const SITE_NOTES: Record<ChatSite, string> = {
  gemini: '嵌入窗口与独立标签页都可用。',
  chatgpt: '嵌入窗口与独立标签页都可用。',
  claude: '嵌入窗口可用；首次进入可能需要完成人机验证。',
  deepseek: '嵌入窗口与独立标签页都可用。',
  grok: 'Grok 的回复依赖 WebSocket，在嵌入窗口里常被浏览器拦截；建议用独立标签页承载。',
  kimi: 'Kimi 在嵌入窗口里会忽略脚本触发的发送操作，只能用独立标签页承载。',
  qwen: '嵌入窗口与独立标签页都可用。',
  glm: '智谱清言在新建页面或嵌入窗口里会反复要求滑块人机验证，只能用独立标签页承载；在该页面里完成一次验证后可长期复用。',
}

export const SITE_CAPABILITIES: SiteCapability[] = CHAT_SITE_LIST.map(site => ({
  site,
  label: chatSiteLabel(site),
  embeddable: isEmbeddableChatSite(site),
  note: SITE_NOTES[site],
}))

export function siteLabelFor(site: ChatSite | undefined): string {
  return SITE_CAPABILITIES.find(capability => capability.site === site)?.label ?? '未知站点'
}

function resolveRoleTabUrl(store: OpenTeamStore, role: GroupRole): string {
  return getDefaultChatSiteUrlForRole(role, store.settings.defaultChatSite)
}

export function createHostModeHandlers(deps: HostModeHandlersDependencies): BackgroundMessageRoute[] {
  const handleHostModeSet = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const roleId = requireString(message.roleId, '缺少人员 ID')
    const hostMode = readHostMode(message.hostMode)
    deps.log.info('role-host-mode:set', { chatId, roleId, hostMode })

    const previous = await mutateStore(store => {
      const chat = requireChat(store, chatId)
      const role = requireRole(store, chat.id, roleId)
      const previousTabId = role.hostedTabId
      role.hostMode = hostMode
      role.status = 'loading'
      role.updatedAt = deps.now()
      chat.status = 'initializing'
      chat.updatedAt = role.updatedAt
      if (hostMode === 'iframe') delete role.hostedTabId
      return { previousTabId, url: resolveRoleTabUrl(store, role) }
    })

    if (hostMode === 'iframe') {
      deps.runtimeFrames.removeRole(chatId, roleId)
      if (previous.result.previousTabId !== undefined) await deps.roleTabHost.close(previous.result.previousTabId)
      await deps.broadcastStoreUpdated(previous.store)
      return { ok: true, store: previous.store }
    }

    const opened = await deps.roleTabHost.open({
      role: { id: roleId, chatId, name: '' },
      url: previous.result.url,
      existingTabId: previous.result.previousTabId,
    })
    const { store } = await mutateStore(draft => {
      const chat = requireChat(draft, chatId)
      const role = requireRole(draft, chat.id, roleId)
      role.hostedTabId = opened.tabId
      role.updatedAt = deps.now()
      draft.chatsById[chat.id].updatedAt = role.updatedAt
    })
    await deps.broadcastStoreUpdated(store)
    void deps.roleTabHost.attach({ type: 'TEAM_ATTACH_ROLE', chatId, roleId, hostTabId: messageHubTabId(message) }, opened.tabId).then(attached => {
      if (!attached) deps.log.warn('role-host-mode:attach-timeout', { chatId, roleId, tabId: opened.tabId })
    })
    return { ok: true, store, tabId: opened.tabId }
  }

  const handleHostTabFocus = async (message: RuntimeMessage) => {
    const chatId = requireString(message.chatId, '缺少群聊 ID')
    const roleId = requireString(message.roleId, '缺少人员 ID')
    const { store, result } = await mutateStore(draft => {
      const chat = requireChat(draft, chatId)
      const role = requireRole(draft, chat.id, roleId)
      if (role.hostMode !== 'tab') throw new Error('该人员当前不是标签页承载模式')
      return { role, url: resolveRoleTabUrl(draft, role), tabId: role.hostedTabId }
    })
    const opened = await deps.roleTabHost.open({
      role: { id: roleId, chatId, name: result.role.name },
      url: result.url,
      existingTabId: result.tabId,
    })
    if (opened.tabId !== result.tabId) {
      await mutateStore(draft => {
        const chat = requireChat(draft, chatId)
        const role = requireRole(draft, chat.id, roleId)
        role.hostedTabId = opened.tabId
        role.updatedAt = deps.now()
        chat.updatedAt = role.updatedAt
      })
      await deps.broadcastStoreUpdated(store)
    }
    void deps.roleTabHost.attach({ type: 'TEAM_ATTACH_ROLE', chatId, roleId, hostTabId: messageHubTabId(message) }, opened.tabId)
    return { ok: true, tabId: opened.tabId }
  }

  const handleConnectionCheck = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    await syncHostedRoles(typeof message.chatId === 'string' ? message.chatId : undefined)
    const store = await loadStore()
    const chatId = typeof message.chatId === 'string' ? message.chatId : store.chatOrder[0]
    if (!chatId || !store.chatsById[chatId]) throw new Error('缺少群聊 ID')
    const chat: GroupChat = store.chatsById[chatId]
    rememberHost(sender)
    const roles = await Promise.all(
      getChatRoles(store, chat)
        .filter(role => role.modelSource !== 'external')
        .map(async (role): Promise<RoleConnectionReport> => {
          const binding = deps.runtimeFrames.getByRole(chat.id, role.id)
          const hostMode = role.hostMode ?? defaultHostModeForSite(role.chatSite)
          const tabId = role.hostedTabId
          const tabAlive = hostMode === 'tab' && tabId !== undefined ? await deps.roleTabHost.isAlive(tabId) : hostMode === 'iframe'
          return {
            roleId: role.id,
            name: role.name,
            site: role.chatSite,
            siteLabel: siteLabelFor(role.chatSite),
            hostMode,
            inTeamPage: hostMode === 'iframe',
            tabId,
            tabAlive,
            ready: Boolean(binding?.ready),
            status: role.status,
            detail: role.siteHealth?.detail,
          }
        }),
    )
    deps.log.info('connection-check:done', {
      chatId: chat.id,
      roles: roles.map(role => ({ roleId: role.roleId, hostMode: role.hostMode, ready: role.ready, tabAlive: role.tabAlive })),
    })
    const report: ConnectionReport = { chatId: chat.id, chatName: chat.name, roles, sites: SITE_CAPABILITIES }
    return { ok: true, data: report }
  }

  /**
   * Re-attaches tab-hosted members whose content script lost its binding (extension reload, tab
   * restored from another window, background restart). The team page calls this after it loads the
   * store, and the connection check calls it so the report reflects reality.
   */
  const syncHostedRoles = async (chatId: string | undefined): Promise<{ attached: string[]; missing: string[] }> => {
    const store = await loadStore()
    const fallbackChatId = store.currentChatId
    const chat = (chatId ? store.chatsById[chatId] : undefined) ?? (fallbackChatId ? store.chatsById[fallbackChatId] : undefined)
    if (!chat) return { attached: [], missing: [] }
    const attached: string[] = []
    const missing: string[] = []
    for (const role of getChatRoles(store, chat)) {
      if (role.modelSource === 'external') continue
      if ((role.hostMode ?? defaultHostModeForSite(role.chatSite)) !== 'tab') continue
      if (deps.runtimeFrames.getByRole(chat.id, role.id)?.ready) continue
      const tabId = role.hostedTabId
      if (tabId === undefined || !(await deps.roleTabHost.isAlive(tabId))) {
        missing.push(role.id)
        continue
      }
      const ok = await deps.roleTabHost.attach({ type: 'TEAM_ATTACH_ROLE', chatId: chat.id, roleId: role.id }, tabId)
      if (ok) {
        attached.push(role.id)
        continue
      }
      // A content script that was injected by an older extension build cannot answer; reloading the
      // tab re-injects it, and its own lookup loop re-attaches the role a moment later.
      missing.push(role.id)
      await deps.roleTabHost.reload(tabId)
    }
    if (attached.length > 0) deps.log.info('hosted-roles:reattached', { chatId: chat.id, attached })
    return { attached, missing }
  }

  const handleHostedRolesSync = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    rememberHost(sender)
    const chatId = typeof message.chatId === 'string' ? message.chatId : undefined
    return { ok: true, data: await syncHostedRoles(chatId) }
  }

  const handleHostedRoleLookup = async (message: RuntimeMessage, sender: chrome.runtime.MessageSender) => {
    const tabId = messageTabId(message, sender)
    if (tabId === undefined) return { ok: false, error: '缺少 sender tab' }
    const store = await loadStore()
    const role = Object.values(store.rolesById).find(candidate => candidate.hostedTabId === tabId)
    if (!role) return { ok: false }
    rememberHost(sender)
    deps.log.info('hosted-role:lookup-hit', { tabId, chatId: role.chatId, roleId: role.id, senderUrl: sender.url })
    return {
      ok: true,
      assignment: { chatId: role.chatId, roleId: role.id, hostTabId: isNumber(message.hostTabId) ? message.hostTabId : undefined },
    }
  }

  return [
    { type: 'GROUP_ROLE_HOST_MODE_SET', handler: handleHostModeSet },
    { type: 'GROUP_ROLE_HOST_TAB_FOCUS', handler: handleHostTabFocus },
    { type: 'GROUP_CONNECTION_CHECK', handler: handleConnectionCheck },
    { type: 'GROUP_HOSTED_ROLES_SYNC', handler: handleHostedRolesSync },
    { type: 'TEAM_HOSTED_ROLE_LOOKUP', handler: handleHostedRoleLookup },
  ]
}

function messageHubTabId(message: RuntimeMessage): number | undefined {
  return isNumber(message.hostTabId) ? message.hostTabId : undefined
}

function readHostMode(value: unknown): 'iframe' | 'tab' {
  return value === 'tab' ? 'tab' : 'iframe'
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value) throw new Error(message)
  return value
}
