import { formatContextMessage } from './contextSync'
import { buildPrompt } from './promptBuilder'
import { normalizeLanguage } from '../shared/i18n'
import type { GroupChat, GroupMessage, GroupRole, OpenTeamLanguage, OpenTeamStore } from './types'

export interface ExternalModelPromptResult {
  content: string
  memoryPatch?: ExternalMemoryPatch
}

export interface BuildExternalModelPromptOptions {
  responseInstruction?: string
  maxContextChars?: number
  attachmentContext?: string
}

export type ExternalMemoryPatch =
  | { scope: 'role'; id: string; summary: string; summarizedThroughSeq: number }
  | { scope: 'chat'; id: string; summary: string; summarizedThroughSeq: number }

export function buildExternalModelPrompt(
  store: OpenTeamStore,
  chat: GroupChat,
  role: GroupRole,
  userMessage: GroupMessage,
  roles: GroupRole[],
  options: BuildExternalModelPromptOptions = {},
): ExternalModelPromptResult {
  const scopedMessages = externalContextMessages(store, chat, role, userMessage)
  const scope = chat.mode === 'collaborative' ? 'chat' : 'role'
  const memory = scope === 'chat' ? store.externalChatMemoriesById?.[chat.id] : store.externalRoleMemoriesById?.[role.id]
  const contextAfterMemory = scopedMessages.filter(message => message.seq > (memory?.summarizedThroughSeq ?? 0) && message.id !== userMessage.id)
  const budget = Math.max(240, options.maxContextChars ?? store.settings.maxContextChars)
  const language = normalizeLanguage(store.settings.language)
  const directPrompt = buildPromptWithExternalContext(chat, role, userMessage, roles, contextAfterMemory, budget, options, language)
  const withSummary = joinSections([
    memory?.summary ? `${language === 'en' ? 'Conversation summary:' : '历史摘要：'}\n${memory.summary}` : undefined,
    directPrompt,
  ])
  if (withSummary.length <= budget) return { content: withSummary }

  const compressible = contextAfterMemory.slice(0, Math.max(0, contextAfterMemory.length - 1))
  if (compressible.length === 0) {
    return { content: trimPromptFromStart(withSummary, budget, language) }
  }

  const summarizedMessages = contextAfterMemory
  const summarizedThroughSeq = summarizedMessages[summarizedMessages.length - 1]?.seq ?? memory?.summarizedThroughSeq ?? 0
  const summary = compressMessages(memory?.summary, summarizedMessages, language)
  const compressedPrompt = joinSections([
    summary ? `${language === 'en' ? 'Conversation summary:' : '历史摘要：'}\n${summary}` : undefined,
    buildPromptWithExternalContext(chat, role, userMessage, roles, [], budget, options, language),
  ])

  return {
    content: trimPromptFromStart(compressedPrompt, budget, language),
    memoryPatch: scope === 'chat'
      ? { scope, id: chat.id, summary, summarizedThroughSeq }
      : { scope, id: role.id, summary, summarizedThroughSeq },
  }
}

function buildPromptWithExternalContext(
  chat: GroupChat,
  role: GroupRole,
  userMessage: GroupMessage,
  roles: GroupRole[],
  contextMessages: GroupMessage[],
  maxContextChars: number,
  options: BuildExternalModelPromptOptions,
  language: OpenTeamLanguage,
): string {
  const basePrompt = buildPrompt({
    chat,
    role,
    userMessage,
    roles,
    unsyncedMessages: contextMessages,
    maxContextChars,
    reference: userMessage.references?.[0],
    includePersona: true,
    responseInstruction: options.responseInstruction,
    attachmentContext: options.attachmentContext,
    language,
  })
  if (chat.mode === 'collaborative' || contextMessages.length === 0) return basePrompt

  const context = contextMessages.map(message => formatContextMessage(message, language)).join('\n\n')
  return joinSections([
    context ? `${language === 'en' ? 'Previous context between you and the user:' : '你和用户此前的上下文：'}\n${context}` : undefined,
    basePrompt,
  ])
}

function externalContextMessages(store: OpenTeamStore, chat: GroupChat, role: GroupRole, userMessage: GroupMessage): GroupMessage[] {
  const messages = chat.messageIds
    .map(messageId => store.messagesById[messageId])
    .filter((message): message is GroupMessage => Boolean(message))
    .filter(message => message.seq <= userMessage.seq)
    .sort((left, right) => left.seq - right.seq || left.createdAt - right.createdAt)

  if (chat.mode === 'collaborative') return messages

  return messages.filter(message => (
    message.id === userMessage.id ||
    message.roleId === role.id ||
    Boolean(message.targetRoleIds?.includes(role.id))
  ))
}

function compressMessages(previousSummary: string | undefined, messages: GroupMessage[], language: OpenTeamLanguage): string {
  const bullets = messages
    .filter(message => message.content.trim())
    .map(message => `- ${speakerLabel(message, language)}${language === 'en' ? ': ' : '：'}${compactContent(message.content)}`)
  return joinSections([
    previousSummary,
    bullets.length > 0 ? bullets.join('\n') : undefined,
  ])
}

function compactContent(content: string): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized
}

function speakerLabel(message: GroupMessage, language: OpenTeamLanguage): string {
  if (message.type === 'assistant') return message.roleName || (language === 'en' ? 'Person' : '人员')
  if (message.type === 'system') return language === 'en' ? 'System' : '系统'
  return language === 'en' ? 'User' : '用户'
}

function trimPromptFromStart(prompt: string, budget: number, language: OpenTeamLanguage): string {
  if (prompt.length <= budget) return prompt
  const head = prompt.slice(0, Math.floor(budget * 0.45)).trimEnd()
  const tail = prompt.slice(-Math.floor(budget * 0.55)).trimStart()
  const omittedLabel = language === 'en' ? '[Middle context omitted]' : '[中间上下文已省略]'
  return `${head}\n\n${omittedLabel}\n\n${tail}`
}

function joinSections(sections: Array<string | undefined>): string {
  return sections.filter((section): section is string => Boolean(section?.trim())).join('\n\n')
}
