import { isChatSite } from './chatSites'
import type { ChatSite, GroupRole, OpenTeamStore, PromptAttachmentPayload, ReplyImageSource, RoleSiteHealthStatus, RoleStatus } from './types'

export type RuntimeRoleStatus =
  | 'opening'
  | 'online'
  | 'sending'
  | 'generating'
  | 'stopped'
  | 'idle'
  | 'offline'
  | 'error'

export type SiteStatus = RoleSiteHealthStatus

export type SendPromptMessage = {
  type: 'TEAM_SEND_PROMPT'
  chatId: string
  roleId: string
  messageId: string
  replyAttemptId?: string
  content: string
  autoSend?: boolean
  includesPersona?: boolean
  isRetry?: boolean
  attachments?: PromptAttachmentPayload[]
}

export type StopGenerationMessage = {
  type: 'TEAM_STOP_GENERATION'
  chatId: string
  roleId: string
  messageId?: string
  replyAttemptId?: string
}

export type ResyncReplyMessage = {
  type: 'TEAM_RESYNC_REPLY'
  chatId: string
  roleId: string
  messageId: string
  currentContent?: string
}

export type AttachRoleMessage = {
  type: 'TEAM_ATTACH_ROLE'
  chatId: string
  roleId: string
  hostTabId?: number
}

export type BackgroundToRoleMessage = SendPromptMessage | StopGenerationMessage | ResyncReplyMessage | AttachRoleMessage

export type HostedRoleLookupMessage = {
  type: 'TEAM_HOSTED_ROLE_LOOKUP'
  url?: string
}

export type HostedRoleLookupResponse = {
  ok: boolean
  assignment?: { chatId: string; roleId: string; hostTabId?: number }
  error?: string
}

export type RoleToBackgroundMessage =
  | HostedRoleLookupMessage
  | { type: 'TEAM_FRAME_ROLE_READY'; chatId?: string; roleId: string; hostTabId?: number; conversationId: string; conversationUrl?: string }
  | { type: 'TEAM_ROLE_CONVERSATION_UPDATED'; chatId: string; roleId: string; conversationId?: string; conversationUrl?: string }
  | { type: 'TEAM_SEND_ACK'; chatId: string; roleId: string; messageId: string }
  | { type: 'TEAM_ROLE_ERROR'; chatId: string; roleId: string; messageId?: string; reason: string; replyAttemptId?: string }
  | { type: 'TEAM_ROLE_STATUS'; status: RuntimeRoleStatus; chatId?: string; roleId?: string; error?: string }
  | {
      type: 'TEAM_ROLE_REPLY_RESYNC'
      chatId?: string
      roleId?: string
      messageId: string
      content: string
      contentFormat?: 'markdown'
      images?: ReplyImageSource[]
      conversationId?: string
      conversationUrl?: string
    }
  | {
      type: 'TEAM_ROLE_REPLY'
      chatId?: string
      roleId?: string
      messageId?: string
      replyAttemptId?: string
      content: string
      contentFormat?: 'markdown'
      images?: ReplyImageSource[]
      conversationId?: string
      conversationUrl?: string
    }
  | { type: 'TEAM_SITE_STATUS_UPDATE'; siteId: string; status: SiteStatus; detail?: string }

export interface FrameRoleReadyResponse {
  ok: boolean
  role?: Pick<GroupRole, 'id' | 'name' | 'chatId'>
  store?: OpenTeamStore
  replyHistory?: string[]
  error?: string
}

export function mapRuntimeRoleStatus(value: unknown): RoleStatus | undefined {
  switch (value) {
    case 'opening':
    case 'offline':
      return 'loading'
    case 'sending':
    case 'generating':
      return 'thinking'
    case 'stopped':
      return 'stopped'
    case 'online':
    case 'idle':
      return 'ready'
    case 'error':
      return 'error'
    default:
      return undefined
  }
}

export { CHAT_SITE_LIST as CHAT_SITES } from './chatSites'

export function isRuntimeChatSite(value: unknown): value is ChatSite {
  return isChatSite(value)
}
