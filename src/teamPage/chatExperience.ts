import type { GroupChat, GroupMessage, GroupRole } from '../group/types'

export const THINKING_TIMEOUT_MS = 120_000
const MESSAGE_TIME_GAP_MS = 5 * 60_000

export type KeyboardShortcutEvent = Pick<KeyboardEvent, 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'> & Partial<Pick<KeyboardEvent, 'isComposing'>>

interface GraphemeSegment {
  segment: string
}

interface GraphemeSegmenter {
  segment(value: string): Iterable<GraphemeSegment>
}

interface IntlWithSegmenter {
  Segmenter?: new (locale: string | undefined, options: { granularity: 'grapheme' }) => GraphemeSegmenter
}

export type ChatRenderItem =
  | { type: 'time'; id: string; label: string }
  | { type: 'message'; id: string; message: GroupMessage; showName: boolean; showAvatar: boolean }

export function getAvatarInitial(name: string | undefined, fallback = 'AI'): string {
  const trimmed = name?.trim()
  if (!trimmed) return fallback

  const Segmenter = (Intl as IntlWithSegmenter).Segmenter
  const segmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : undefined
  const firstSegment = segmenter?.segment(trimmed)[Symbol.iterator]().next().value?.segment
  return (firstSegment ?? Array.from(trimmed)[0] ?? fallback).toUpperCase()
}

export function shouldConfirmMentionWithEnter(event: KeyboardShortcutEvent): boolean {
  return event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.metaKey && !event.ctrlKey
}

export function shouldSendMessageWithEnter(event: KeyboardShortcutEvent): boolean {
  return event.key === 'Enter' && !event.isComposing && !event.shiftKey && !event.metaKey && !event.ctrlKey
}

export function isThinkingBubbleVisible(role: Pick<GroupRole, 'status' | 'updatedAt'>, now = Date.now()): boolean {
  return role.status === 'thinking' && now - role.updatedAt < THINKING_TIMEOUT_MS
}

export function getVisibleThinkingRoles(roles: GroupRole[], now = Date.now()): GroupRole[] {
  return roles.filter(role => isThinkingBubbleVisible(role, now))
}

export function getStoppedReplyRoles(roles: GroupRole[]): GroupRole[] {
  return roles.filter(role => role.status === 'stopped' && Boolean(role.lastPromptMessageId))
}

export function shouldAutoReconnectRole(role: Pick<GroupRole, 'modelSource' | 'status' | 'updatedAt'>, now = Date.now()): boolean {
  if (role.modelSource === 'external') return false
  if (role.status === 'ready') return false
  if (role.status === 'stopped') return false
  if (role.status !== 'thinking') return true
  return now - role.updatedAt >= THINKING_TIMEOUT_MS
}

export function isUnavailableRolesError(message: string): boolean {
  return message.includes('以下人员不可用，请等待或恢复') || message.includes('人员页面尚未就绪') || message.includes('人员 iframe 尚未就绪')
}

export interface ChatStartupNotice {
  title: string
  body: string
}

export function getChatStartupNotice(chat: Pick<GroupChat, 'status'>, roles: Pick<GroupRole, 'status'>[]): ChatStartupNotice | undefined {
  const hasStartingRole = roles.some(role => role.status === 'pending' || role.status === 'loading')
  if (chat.status !== 'initializing' && chat.status !== 'running' && !hasStartingRole) return undefined
  return {
    title: '正在初始化角色',
    body: '正在创建角色窗口，准备好后就可以继续对话。',
  }
}

export function formatChatListTime(timestamp: number, now = Date.now()): string {
  if (!timestamp) return '-'

  const current = new Date(now)
  const target = new Date(timestamp)
  const currentDay = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime()
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  const dayDelta = Math.round((currentDay - targetDay) / 86_400_000)

  if (dayDelta === 0) {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(target)
  }
  if (dayDelta === 1) return '昨天'
  if (dayDelta === 2) return '前天'

  const month = String(target.getMonth() + 1).padStart(2, '0')
  const day = String(target.getDate()).padStart(2, '0')
  if (target.getFullYear() === current.getFullYear()) return `${month}/${day}`
  return `${target.getFullYear()}/${month}/${day}`
}

export function formatMessageTime(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}

export function buildChatRenderItems(messages: GroupMessage[], roles: GroupRole[], now = Date.now()): ChatRenderItem[] {
  void roles
  const items: ChatRenderItem[] = []
  let previousMessage: GroupMessage | undefined
  let previousTimestamp = 0

  for (const message of messages) {
    if (!previousTimestamp || message.createdAt - previousTimestamp >= MESSAGE_TIME_GAP_MS) {
      items.push({
        type: 'time',
        id: `time-${message.id}`,
        label: formatMessageTime(message.createdAt || now),
      })
    }

    const sameSpeaker =
      previousMessage?.type === message.type &&
      previousMessage?.roleId === message.roleId &&
      message.type !== 'system' &&
      message.createdAt - previousTimestamp < MESSAGE_TIME_GAP_MS
    items.push({
      type: 'message',
      id: message.id,
      message,
      showName: message.type === 'assistant' && !sameSpeaker,
      showAvatar: message.type === 'user' || message.type === 'assistant' ? !sameSpeaker : false,
    })

    previousMessage = message
    previousTimestamp = message.createdAt
  }

  return items
}
