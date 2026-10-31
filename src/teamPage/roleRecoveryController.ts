import type { GroupChat, GroupMessage, GroupRole, OpenTeamStore } from '../group/types'
import type { RoleReadyWaiter, TeamPageState } from './appState'
import { shouldAutoReconnectRole } from './chatExperience'
import { runCommandWithReconnect } from './sendWithReconnect'

const AUTO_RECONNECT_TIMEOUT_MS = 90_000
const ROLE_READY_POLL_MS = 1_000

interface RoleRecoveryIframeHost {
  focusRoleFrame(chatId: string, roleId: string): boolean
  recoverRole(role: GroupRole): void
}

export interface RoleRecoveryDependencies {
  state: TeamPageState
  getStore(): OpenTeamStore
  getCurrentRoles(): GroupRole[]
  refreshStore(showFailure?: boolean): Promise<void>
  switchChat(chatId: string): void
  renderComposerState(): void
  setWindowMinimized(minimized: boolean): void
  iframeHost: RoleRecoveryIframeHost
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  showError(message: string): void
  log: {
    info(event: string, details?: Record<string, unknown>): void
    warn(event: string, details?: Record<string, unknown>): void
  }
}

export interface RoleRecoveryController {
  focusRoleFrame(chatId: string, roleId: string | undefined): void
  notifyRoleReadyWaiters(): void
  reconnectRolesForSend(chat: GroupChat, roles: GroupRole[]): Promise<void>
  refreshCurrentChat(): Promise<void>
  resyncMessageReply(message: GroupMessage): Promise<void>
  retryRoleReply(role: GroupRole, messageId?: string): Promise<void>
  stopRoleReply(role: GroupRole): Promise<void>
}

export function createRoleRecoveryController(deps: RoleRecoveryDependencies): RoleRecoveryController {
  async function refreshCurrentChat(): Promise<void> {
    await deps.refreshStore()
    const store = deps.getStore()
    const chat = deps.state.selectedChatId ? store.chatsById[deps.state.selectedChatId] : undefined
    if (!chat) return

    const reconnectableRoles = deps.getCurrentRoles().filter(shouldRefreshRoleManually)
    if (reconnectableRoles.length === 0) return

    deps.log.info('ui:refresh-recover-chat', { chatId: chat.id, roleIds: reconnectableRoles.map(role => role.id) })
    await reconnectRolesForSend(chat, reconnectableRoles)
    await deps.refreshStore(false)
  }

  function areRolesReady(chatId: string, roleIds: string[]): boolean {
    const store = deps.getStore()
    return roleIds.every(roleId => {
      const role = store.rolesById[roleId]
      return role?.chatId === chatId && role.status === 'ready'
    })
  }

  function notifyRoleReadyWaiters(): void {
    for (const waiter of [...deps.state.roleReadyWaiters]) {
      if (!areRolesReady(waiter.chatId, [...waiter.roleIds])) continue
      waiter.resolve()
    }
  }

  function waitForRolesReady(chatId: string, roleIds: string[], timeoutMs = AUTO_RECONNECT_TIMEOUT_MS): Promise<void> {
    const uniqueRoleIds = [...new Set(roleIds)]
    if (areRolesReady(chatId, uniqueRoleIds)) return Promise.resolve()

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(waiter.timeoutId)
        if (waiter.pollTimeoutId !== undefined) window.clearTimeout(waiter.pollTimeoutId)
        deps.state.roleReadyWaiters.delete(waiter)
      }
      const resolveReady = () => {
        cleanup()
        resolve()
      }
      const rejectTimeout = () => {
        cleanup()
        reject(new Error(`等待人员恢复超时：${roleLabels(chatId, uniqueRoleIds).join('、')}`))
      }
      const schedulePoll = () => {
        waiter.pollTimeoutId = window.setTimeout(() => {
          deps.refreshStore(false)
            .then(() => {
              if (areRolesReady(chatId, uniqueRoleIds)) {
                resolveReady()
                return
              }
              schedulePoll()
            })
            .catch(() => schedulePoll())
        }, ROLE_READY_POLL_MS)
      }
      const waiter: RoleReadyWaiter = {
        chatId,
        roleIds: new Set(uniqueRoleIds),
        resolve: resolveReady,
        reject,
        timeoutId: window.setTimeout(rejectTimeout, timeoutMs),
      }
      deps.state.roleReadyWaiters.add(waiter)
      schedulePoll()
    })
  }

  async function reconnectRolesForSend(chat: GroupChat, roles: GroupRole[]): Promise<void> {
    const uniqueRoles = [...new Map(roles.filter(role => role.modelSource !== 'external').map(role => [role.id, role])).values()]
    if (uniqueRoles.length === 0) return

    for (const role of uniqueRoles) deps.state.reconnectingRoleKeys.add(teamRoleKey(chat.id, role.id))
    deps.renderComposerState()

    const iframeRoles = uniqueRoles.filter(role => role.hostMode !== 'tab')
    const tabRoles = uniqueRoles.filter(role => role.hostMode === 'tab')

    try {
      deps.log.info('roles:auto-reconnect:start', { chatId: chat.id, roleIds: uniqueRoles.map(role => role.id) })
      await Promise.all([
        ...iframeRoles.map(role => deps.runCommand('GROUP_ROLE_RECOVER', { chatId: chat.id, roleId: role.id })),
        ...tabRoles.map(role => deps.runCommand('GROUP_ROLE_HOST_TAB_FOCUS', { chatId: chat.id, roleId: role.id })),
      ])
      for (const role of iframeRoles) deps.iframeHost.recoverRole(role)
      await waitForRolesReady(chat.id, uniqueRoles.map(role => role.id))
      deps.log.info('roles:auto-reconnect:ready', { chatId: chat.id, roleIds: uniqueRoles.map(role => role.id) })
    } finally {
      for (const role of uniqueRoles) deps.state.reconnectingRoleKeys.delete(teamRoleKey(chat.id, role.id))
      deps.renderComposerState()
    }
  }

  function focusRoleFrame(chatId: string, roleId: string | undefined): void {
    if (!roleId) return
    const store = deps.getStore()
    const role = store.rolesById[roleId]
    if (!role) return
    if (role.modelSource === 'external') return
    if (role.hostMode === 'tab') {
      deps.setWindowMinimized(true)
      const chat = store.chatsById[chatId]
      if (chat && deps.state.selectedChatId !== chatId) deps.switchChat(chatId)
      deps.runCommand('GROUP_ROLE_HOST_TAB_FOCUS', { chatId, roleId })
        .catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
      return
    }

    deps.setWindowMinimized(true)
    const chat = store.chatsById[chatId]
    if (chat && deps.state.selectedChatId !== chatId) deps.switchChat(chatId)
    if (deps.iframeHost.focusRoleFrame(chatId, roleId)) return
    deps.iframeHost.recoverRole(role)
  }

  async function stopRoleReply(role: GroupRole): Promise<void> {
    const chat = deps.getStore().chatsById[role.chatId]
    if (!chat) return
    await deps.runCommand('GROUP_ROLE_STOP_REPLY', { chatId: chat.id, roleId: role.id })
    await deps.refreshStore(false)
  }

  async function retryRoleReply(role: GroupRole, messageId = role.lastPromptMessageId): Promise<void> {
    const chat = deps.getStore().chatsById[role.chatId]
    if (!chat) return
    await runCommandWithReconnect({
      reconnectRolesForSend,
      runCommand: deps.runCommand,
    }, {
      chat,
      roles: [role],
      type: 'GROUP_ROLE_RETRY_REPLY',
      payload: { chatId: chat.id, roleId: role.id, messageId },
    })
    await deps.refreshStore(false)
  }

  async function resyncMessageReply(message: GroupMessage): Promise<void> {
    deps.log.warn('message-resync:start', { chatId: message.chatId, roleId: message.roleId, messageId: message.id })
    if (!message.roleId) {
      deps.log.warn('message-resync:skip-missing-role', { chatId: message.chatId, messageId: message.id })
      return
    }
    const store = deps.getStore()
    const chat = store.chatsById[message.chatId]
    const role = store.rolesById[message.roleId]
    if (!chat || !role || role.chatId !== chat.id) {
      deps.log.warn('message-resync:skip-missing-chat-role', {
        chatId: message.chatId,
        roleId: message.roleId,
        messageId: message.id,
        hasChat: Boolean(chat),
        hasRole: Boolean(role),
        roleChatId: role?.chatId,
      })
      return
    }

    try {
      deps.log.warn('message-resync:command:start', { chatId: chat.id, roleId: role.id, messageId: message.id })
      await runMessageResync(chat, role, message)
    } catch (error) {
      deps.log.warn('message-resync:command:failed', {
        chatId: chat.id,
        roleId: role.id,
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      })
      if (!isIframeNotReadyError(error)) throw error
      deps.log.warn('message-resync:recover:start', { chatId: chat.id, roleId: role.id, messageId: message.id })
      await reconnectRolesForSend(chat, [role])
      deps.log.warn('message-resync:retry:start', { chatId: chat.id, roleId: role.id, messageId: message.id })
      await runMessageResync(chat, role, message)
    }
    deps.log.warn('message-resync:done', { chatId: chat.id, roleId: role.id, messageId: message.id })
  }

  async function runMessageResync(chat: GroupChat, role: GroupRole, message: GroupMessage): Promise<void> {
    await deps.runCommand('GROUP_MESSAGE_RESYNC_REPLY', { chatId: chat.id, roleId: role.id, messageId: message.id })
  }

  return { focusRoleFrame, notifyRoleReadyWaiters, reconnectRolesForSend, refreshCurrentChat, resyncMessageReply, retryRoleReply, stopRoleReply }

  function roleLabels(chatId: string, roleIds: string[]): string[] {
    const store = deps.getStore()
    return roleIds.map(roleId => {
      const role = store.rolesById[roleId]
      return role?.chatId === chatId && role.name.trim() ? role.name : roleId
    })
  }
}

function shouldRefreshRoleManually(role: GroupRole): boolean {
  if (role.modelSource === 'external') return false
  if (role.status === 'thinking') return shouldAutoReconnectRole(role)
  return true
}

function teamRoleKey(chatId: string, roleId: string): string {
  return `${chatId}:${roleId}`
}

function isIframeNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('人员页面尚未就绪') || message.includes('人员 iframe 尚未就绪')
}
