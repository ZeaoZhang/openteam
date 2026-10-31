import { buildUnsyncedContext } from '../group/contextSync'
import { contextCharBudgetForRole } from '../group/contextBudget'
import { buildExternalModelPrompt, type ExternalMemoryPatch } from '../group/externalModelContext'
import { buildOrchestrationReviewResponseInstruction } from '../group/orchestrationPrompts'
import { buildPrompt, roleUsesChatGptGptsPersona } from '../group/promptBuilder'
import type { ExternalModelConfig, GroupChat, GroupMessage, GroupRole, MessageReference, OpenTeamStore } from '../group/types'
import type { PromptDelivery } from './promptDelivery'
import type { RuntimeFrameRegistry } from './runtimeFrames'

export interface ExternalPromptDelivery {
  roleId: string
  chatId: string
  messageId: string
  replyAttemptId: string
  model: ExternalModelConfig
  prompt: string
}

export type PreparedRolePromptDelivery = {
  includesPersona: boolean
  replyAttemptId: string
  roleHistoryCount: number
} & (
  | { delivery: PromptDelivery; externalDelivery?: undefined }
  | { delivery?: undefined; externalDelivery: ExternalPromptDelivery }
)

export interface PrepareRolePromptDeliveryInput {
  store: OpenTeamStore
  chat: GroupChat
  role: GroupRole
  userMessage: GroupMessage
  roles: GroupRole[]
  messages: GroupMessage[]
  reference?: MessageReference
  timestamp: number
  newId(prefix: string): string
  runtimeFrames: Pick<RuntimeFrameRegistry, 'getByRole'>
}

export function prepareRolePromptDelivery(input: PrepareRolePromptDeliveryInput): PreparedRolePromptDelivery {
  const roleHistoryCount = countLocalRoleHistory(input.messages, input.role, input.userMessage.id)
  const includesPersona = shouldIncludePersonaForPrompt(input.role, roleHistoryCount)
  const replyAttemptId = input.newId('attempt')
  const responseInstruction = responseInstructionForMessage(input.userMessage, input.store.settings.language)
  const maxContextChars = contextCharBudgetForRole(input.store, input.role)

  if (isExternalModelRole(input.role)) {
    const model = requireExternalModelForRole(input.store, input.role)
    const prompt = buildExternalModelPrompt(input.store, input.chat, input.role, input.userMessage, input.roles, { responseInstruction, maxContextChars })
    if (prompt.memoryPatch) applyExternalMemoryPatch(input.store, prompt.memoryPatch, input.timestamp)
    return {
      includesPersona,
      roleHistoryCount,
      replyAttemptId,
      externalDelivery: {
        roleId: input.role.id,
        chatId: input.chat.id,
        messageId: input.userMessage.id,
        replyAttemptId,
        model,
        prompt: prompt.content,
      },
    }
  }

  const binding = input.runtimeFrames.getByRole(input.chat.id, input.role.id)
  if (!binding?.ready) throw new Error('人员页面尚未就绪，请先恢复人员')
  const unsyncedContext = buildUnsyncedContext(input.chat, input.role, input.messages, input.userMessage, maxContextChars, input.store.settings.language)
  const content = buildPrompt({
    chat: input.chat,
    role: input.role,
    userMessage: input.userMessage,
    roles: input.roles,
    unsyncedContext,
    reference: input.reference,
    includePersona: includesPersona,
    responseInstruction,
    language: input.store.settings.language,
  })

  return {
    includesPersona,
    roleHistoryCount,
    replyAttemptId,
    delivery: {
      roleId: input.role.id,
      chatSite: input.role.chatSite ?? input.store.settings.defaultChatSite,
      tabId: binding.tabId,
      frameId: binding.frameId,
      message: {
        type: 'TEAM_SEND_PROMPT',
        chatId: input.chat.id,
        roleId: input.role.id,
        messageId: input.userMessage.id,
        replyAttemptId,
        content,
        includesPersona,
      },
    },
  }
}

export function isExternalModelRole(role: GroupRole): boolean {
  return role.modelSource === 'external'
}

export function getExternalModelForRole(store: OpenTeamStore, role: GroupRole): ExternalModelConfig | undefined {
  if (!isExternalModelRole(role) || !role.externalModelId) return undefined
  return store.settings.externalModelsById[role.externalModelId]
}

export function requireExternalModelForRole(store: OpenTeamStore, role: GroupRole): ExternalModelConfig {
  const model = getExternalModelForRole(store, role)
  if (!model) throw new Error(`找不到外部模型：${role.externalModelId ?? role.name}`)
  return model
}

function applyExternalMemoryPatch(store: OpenTeamStore, patch: ExternalMemoryPatch, timestamp: number): void {
  if (patch.scope === 'chat') {
    store.externalChatMemoriesById ??= {}
    store.externalChatMemoriesById[patch.id] = {
      chatId: patch.id,
      summary: patch.summary,
      summarizedThroughSeq: patch.summarizedThroughSeq,
      updatedAt: timestamp,
    }
    return
  }

  store.externalRoleMemoriesById ??= {}
  store.externalRoleMemoriesById[patch.id] = {
    roleId: patch.id,
    summary: patch.summary,
    summarizedThroughSeq: patch.summarizedThroughSeq,
    updatedAt: timestamp,
  }
}

function shouldIncludePersonaForPrompt(role: GroupRole, roleHistoryCount: number): boolean {
  return !roleUsesChatGptGptsPersona(role) && roleHistoryCount === 0
}

function countLocalRoleHistory(messages: GroupMessage[], role: GroupRole, currentMessageId: string): number {
  return messages.filter(message => message.id !== currentMessageId && isRoleHistoryMessage(message, role.id)).length
}

function isRoleHistoryMessage(message: GroupMessage, roleId: string): boolean {
  if (message.type !== 'user' || !Array.isArray(message.targetRoleIds) || !message.targetRoleIds.includes(roleId)) return false
  const deliveryStatus = message.deliveryStatus?.[roleId]
  return deliveryStatus === 'sent' || deliveryStatus === 'received'
}

function responseInstructionForMessage(message: GroupMessage, language: OpenTeamStore['settings']['language']): string | undefined {
  return message.orchestrationKind === 'review'
    ? buildOrchestrationReviewResponseInstruction(language)
    : undefined
}
