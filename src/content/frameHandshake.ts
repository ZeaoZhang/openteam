import type {
  BackgroundToRoleMessage,
  FrameRoleReadyResponse,
  HostedRoleLookupResponse,
  RoleToBackgroundMessage,
} from '../group/runtimeProtocol'
import type { ContentLogger } from './runtimeClient'
import type { RoleSession } from './roleSession'
import type { ChatSiteAdapter } from './sites/types'

const FRAME_ASSIGN_MESSAGE = 'OPENTEAM_ASSIGN_FRAME_ROLE'

export interface RoleAssignmentTarget {
  chatId: string
  roleId: string
  hostTabId?: number
}

export interface RoleHandshakeOptions {
  siteAdapter: ChatSiteAdapter
  roleSession: RoleSession
  log: ContentLogger
  seedStoredRoleReplies(replies: string[] | undefined): void
  sendRuntimeMessage<T>(message: RoleToBackgroundMessage): Promise<T>
}

export function reportRoleReady(options: RoleHandshakeOptions, target: RoleAssignmentTarget): Promise<boolean> {
  const snapshot = options.siteAdapter.getConversationSnapshot()
  options.log.info('frame-role:assignment-received', {
    chatId: target.chatId,
    roleId: target.roleId,
    hostTabId: target.hostTabId,
    conversationId: snapshot.conversationId,
  })

  return options
    .sendRuntimeMessage<FrameRoleReadyResponse>({
      type: 'TEAM_FRAME_ROLE_READY',
      chatId: target.chatId,
      roleId: target.roleId,
      hostTabId: target.hostTabId,
      conversationId: snapshot.conversationId || options.siteAdapter.getConversationId(),
      conversationUrl: snapshot.conversationUrl,
    })
    .then(response => {
      if (!response.ok || !response.role) {
        options.log.warn('frame-role:ready-failed', { roleId: target.roleId, error: response.error })
        return false
      }

      options.seedStoredRoleReplies(response.replyHistory)
      options.roleSession.assignRole({
        chatId: target.chatId,
        roleId: response.role.id,
        roleName: response.role.name,
        roomId: response.role.chatId || target.chatId,
      })
      return true
    })
    .catch(error => {
      options.log.warn('frame-role:ready-error', { roleId: target.roleId, error: error instanceof Error ? error.message : String(error) })
      return false
    })
}

export function registerFrameRoleHandshake(options: RoleHandshakeOptions): void {
  window.addEventListener('message', event => {
    if (!event.data || typeof event.data !== 'object') return
    if (event.data.type !== FRAME_ASSIGN_MESSAGE) return

    const chatId = typeof event.data.chatId === 'string' ? event.data.chatId : typeof event.data.roomId === 'string' ? event.data.roomId : ''
    const roleId = typeof event.data.roleId === 'string' ? event.data.roleId : ''
    const hostTabId = typeof event.data.hostTabId === 'number' ? event.data.hostTabId : undefined
    if (!roleId) return

    void reportRoleReady(options, { chatId, roleId, hostTabId })
  })
}

export interface HostedRoleAttachOptions extends RoleHandshakeOptions {
  lookupAttempts?: number
  lookupDelayMs?: number
}

const DEFAULT_LOOKUP_ATTEMPTS = 20
const DEFAULT_LOOKUP_DELAY_MS = 1000

/**
 * Tabs that host a role (`hostMode: 'tab'`) load the chat site directly instead of
 * inside an iframe, so there is no iframe postMessage handshake. The role identity
 * is resolved through the background: first by asking which role owns this tab,
 * then by reacting to late "attach" messages pushed by the background.
 */
export function registerHostedRoleAttach(options: HostedRoleAttachOptions): void {
  let attachedRoleId: string | undefined

  const attach = (target: RoleAssignmentTarget): void => {
    if (attachedRoleId === target.roleId) return
    attachedRoleId = target.roleId
    void reportRoleReady(options, target)
  }

  const lookup = async (remaining: number): Promise<void> => {
    if (attachedRoleId) return
    try {
      const response = await options.sendRuntimeMessage<HostedRoleLookupResponse>({
        type: 'TEAM_HOSTED_ROLE_LOOKUP',
        url: location.href,
      })
      if (response?.ok && response.assignment) {
        attach(response.assignment)
        return
      }
    } catch (error) {
      options.log.warn('hosted-role:lookup-failed', { error: error instanceof Error ? error.message : String(error) })
    }

    if (remaining <= 0) return
    setTimeout(() => void lookup(remaining - 1), options.lookupDelayMs ?? DEFAULT_LOOKUP_DELAY_MS)
  }

  chrome.runtime.onMessage.addListener((message: BackgroundToRoleMessage, _sender, sendResponse) => {
    if (!message || message.type !== 'TEAM_ATTACH_ROLE') return undefined
    attach({ chatId: message.chatId, roleId: message.roleId, hostTabId: message.hostTabId })
    sendResponse({ ok: true })
    return true
  })

  void lookup(options.lookupAttempts ?? DEFAULT_LOOKUP_ATTEMPTS)
}
