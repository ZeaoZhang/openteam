import type { GroupChat, GroupMessage, OpenTeamStore } from '../group/types'
import { getAvatarInitial } from './chatExperience'

export interface EmptyCardOptions {
  icon?: string
  actions?: HTMLElement[]
}

export function emptyCard(title: string, body: string, options: EmptyCardOptions = {}): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.className = 'empty-state'
  const card = document.createElement('div')
  card.className = 'empty-card'
  if (options.icon) {
    const icon = document.createElement('div')
    icon.className = 'empty-icon'
    icon.textContent = options.icon
    icon.setAttribute('aria-hidden', 'true')
    card.append(icon)
  }
  const heading = document.createElement('h3')
  heading.textContent = title
  const paragraph = document.createElement('p')
  paragraph.className = 'muted'
  paragraph.textContent = body
  card.append(heading, paragraph)
  if (options.actions && options.actions.length > 0) {
    const actions = document.createElement('div')
    actions.className = 'empty-actions'
    actions.append(...options.actions)
    card.append(actions)
  }
  wrapper.append(card)
  return wrapper
}

export function roleToneClass(seed: string | undefined): string {
  const source = seed || 'OpenTeam'
  let hash = 0
  for (let index = 0; index < source.length; index += 1) hash = (hash + source.charCodeAt(index) * (index + 1)) % 6
  return `role-tone-${hash}`
}

export function roleAvatarLabel(name: string | undefined): string {
  return getAvatarInitial(name)
}

export function getChatRecentSummary(chat: GroupChat, store: OpenTeamStore): string {
  const lastMessageId = chat.messageIds[chat.messageIds.length - 1]
  const message = lastMessageId ? store.messagesById[lastMessageId] : undefined
  if (!message) return '暂无消息。可恢复聊天、添加人员或发送第一条任务。'
  return `${messageTitle(message)}：${truncate(message.content, 72)}`
}

export function messageTitle(message: GroupMessage): string {
  if (message.type === 'user') return '我'
  if (message.type === 'assistant') return message.roleName || 'AI 人员'
  return '系统'
}

export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value
}
