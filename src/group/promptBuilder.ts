import { formatContextMessage, type UnsyncedContextResult } from './contextSync'
import { PROMPT_I18N, normalizeLanguage } from '../shared/i18n'
import type { GroupChat, GroupMessage, GroupRole, MessageReference, OpenTeamLanguage } from './types'

export interface BuildPromptInput {
  chat: GroupChat
  role: GroupRole
  userMessage: GroupMessage
  roles: GroupRole[]
  unsyncedContext?: UnsyncedContextResult
  unsyncedMessages?: GroupMessage[]
  maxContextChars?: number
  reference?: MessageReference
  includePersona?: boolean
  responseInstruction?: string
  /** Text extracted from user attachments plus descriptors for binary files. */
  attachmentContext?: string
  language?: OpenTeamLanguage
}

export function buildPrompt(input: BuildPromptInput): string {
  return input.chat.mode === 'collaborative'
    ? buildCollaborativePrompt(input)
    : buildIndependentPrompt(input)
}

export function buildIndependentPrompt(input: BuildPromptInput): string {
  const reference = input.reference ?? input.userMessage.references?.[0]
  const language = normalizeLanguage(input.language)
  return joinSections([
    language === 'en' ? `You are "${input.role.name}".` : `你是「${input.role.name}」。`,
    buildRoleBlock(input.role, input.includePersona ?? true, language),
    buildReferenceBlock(reference, language),
    buildAttachmentBlock(input.attachmentContext, language),
    language === 'en' ? `User message:\n${input.userMessage.content}` : `用户消息：\n${input.userMessage.content}`,
    input.responseInstruction ?? independentResponseInstruction(input.role.name, Boolean(reference), language),
  ])
}

export function buildCollaborativePrompt(input: BuildPromptInput): string {
  const reference = input.reference ?? input.userMessage.references?.[0]
  const language = normalizeLanguage(input.language)

  return joinSections([
    language === 'en' ? 'You are in an AI group chat.' : '你正在一个 AI 群聊中。',
    buildMemberList(input.roles, language),
    language === 'en' ? `Your identity is "${input.role.name}".` : `你的身份是「${input.role.name}」。`,
    buildRoleBlock(input.role, input.includePersona ?? true, language),
    buildContextBlock(input, language),
    buildReferenceBlock(reference, language),
    buildAttachmentBlock(input.attachmentContext, language),
    language === 'en' ? `User latest message:\n${input.userMessage.content}` : `用户最新消息：\n${input.userMessage.content}`,
    input.responseInstruction ?? collaborativeResponseInstruction(input.role.name, Boolean(reference), language),
  ])
}

export function buildInitializationPrompt(chat: GroupChat, role: GroupRole, roles: GroupRole[], includePersona = true, languageInput?: OpenTeamLanguage): string {
  const language = normalizeLanguage(languageInput)
  if (chat.mode === 'collaborative') {
    return joinSections([
      language === 'en' ? 'You are in an AI group chat.' : '你正在一个 AI 群聊中。',
      buildMemberList(roles, language),
      language === 'en' ? `Your identity is "${role.name}".` : `你的身份是「${role.name}」。`,
      buildRoleBlock(role, includePersona, language),
      language === 'en'
        ? `Keep your assigned perspective. You may respond to, add to, or challenge other members' points. When the user quotes a member, respond directly to that quoted point. ${PROMPT_I18N.en.responseLanguageInstruction}`
        : `请保持你的人员视角。你可以回应、补充或反驳其他成员的观点。当用户引用某位成员的发言时，请明确回应那条观点。${PROMPT_I18N['zh-CN'].responseLanguageInstruction}`,
    ])
  }

  return joinSections([
    language === 'en' ? `You are "${role.name}".` : `你是「${role.name}」。`,
    buildRoleBlock(role, includePersona, language),
    language === 'en'
      ? `The user will give you tasks. Always keep your assigned perspective and answer independently. Do not assume there are other AI members. ${PROMPT_I18N.en.responseLanguageInstruction}`
      : `用户会给你任务。请始终保持你的人员视角，独立回答，不需要假设还有其他 AI 成员。${PROMPT_I18N['zh-CN'].responseLanguageInstruction}`,
  ])
}

export function buildInitPrompt(chat: GroupChat, role: GroupRole, roles: GroupRole[], includePersona = true, language?: OpenTeamLanguage): string {
  return buildInitializationPrompt(chat, role, roles, includePersona, language)
}

export function buildReinitializationPrompt(chat: GroupChat, role: GroupRole, roles: GroupRole[], includePersona = true, language?: OpenTeamLanguage): string {
  return buildInitializationPrompt(chat, role, roles, includePersona, language)
}

export function buildReinitPrompt(chat: GroupChat, role: GroupRole, roles: GroupRole[], includePersona = true, language?: OpenTeamLanguage): string {
  return buildReinitializationPrompt(chat, role, roles, includePersona, language)
}

export function roleUsesChatGptGptsPersona(role: GroupRole): boolean {
  return role.chatSite === 'chatgpt' && Boolean(role.chatGptGptsUrl?.trim())
}

export function buildMemberList(roles: GroupRole[], languageInput?: OpenTeamLanguage): string {
  const language = normalizeLanguage(languageInput)
  const members = roles.map(role => `- ${role.name}${role.description ? `${language === 'en' ? ': ' : '：'}${role.description}` : ''}`).join('\n')
  return language === 'en' ? `Group chat members:\n${members}` : `群聊成员：\n${members}`
}

function buildRoleBlock(role: GroupRole, includePersona: boolean, language: OpenTeamLanguage): string {
  return joinSections([
    role.description ? `${language === 'en' ? 'Your responsibility:' : '你的职责：'}\n${role.description}` : undefined,
    includePersona && role.systemPrompt ? `${language === 'en' ? 'Persona:' : '人设：'}\n${role.systemPrompt}` : undefined,
  ])
}

function buildContextBlock(input: BuildPromptInput, language: OpenTeamLanguage): string {
  if (input.unsyncedContext) {
    return joinSections([
      input.unsyncedContext.omittedEarlyContext ? (language === 'en' ? 'Some earlier context has been omitted.' : '部分早期上下文已省略。') : undefined,
      input.unsyncedContext.contextText
        ? `${language === 'en' ? 'Since your last turn, the group chat has these new items:' : '你上次之后，群聊里有这些新内容：'}\n${input.unsyncedContext.contextText}`
        : (language === 'en' ? 'Since your last turn, there is no new group-chat content to sync.' : '你上次之后，群聊里没有需要同步的新内容。'),
    ])
  }

  const messages = input.unsyncedMessages ?? []
  if (messages.length === 0) return ''

  const maxContextChars = input.maxContextChars ?? 6000
  const context = messages.map(message => formatContextMessage(message, language)).join('\n\n')
  if (context.length <= maxContextChars) {
    return `${language === 'en' ? 'Since your last turn, the group chat has these new items:' : '你上次之后，群聊里有这些新内容：'}\n${context}`
  }

  return `${language === 'en' ? '[Some earlier context has been omitted]' : '[部分早期上下文已省略]'}\n\n${language === 'en' ? 'Since your last turn, the group chat has these new items:' : '你上次之后，群聊里有这些新内容：'}\n${context.slice(-maxContextChars).trimStart()}`
}

function buildAttachmentBlock(attachmentContext: string | undefined, language: OpenTeamLanguage): string {
  if (!attachmentContext?.trim()) return ''
  return `${language === 'en' ? 'Attachments sent with this message:' : '本条消息附带的文件：'}\n${attachmentContext.trim()}`
}

function buildReferenceBlock(reference: MessageReference | undefined, language: OpenTeamLanguage): string {
  if (!reference) return ''
  if (language === 'en') {
    const source = reference.roleName ? `"${reference.roleName}"'s point` : 'a message'
    return `The user quoted ${source}:\n"${reference.contentSnapshot}"\nRespond directly to this quote.`
  }
  const source = reference.roleName ? `「${reference.roleName}」的观点` : '一条消息'
  return `用户引用了${source}：\n「${reference.contentSnapshot}」\n请明确回应这条引用。`
}

function independentResponseInstruction(roleName: string, hasReference: boolean, language: OpenTeamLanguage): string {
  if (language === 'en') {
    return `Reply as "${roleName}". ${PROMPT_I18N.en.responseLanguageInstruction}${hasReference ? ' State where you agree or disagree and suggest next steps.' : ''}`
  }
  return `请以「${roleName}」身份回复。${PROMPT_I18N['zh-CN'].responseLanguageInstruction}${hasReference ? '请明确说明你同意或不同意哪里，以及下一步建议。' : ''}`
}

function collaborativeResponseInstruction(roleName: string, hasReference: boolean, language: OpenTeamLanguage): string {
  if (language === 'en') {
    return `Reply as "${roleName}". You may reference, add to, or challenge other members' points. ${PROMPT_I18N.en.responseLanguageInstruction}${hasReference ? ' Respond directly to the point quoted by the user.' : ''}`
  }
  return `请以「${roleName}」身份回复。你可以参考、补充或反驳其他成员观点。${PROMPT_I18N['zh-CN'].responseLanguageInstruction}${hasReference ? '请明确回应用户引用的观点。' : ''}`
}

function joinSections(sections: Array<string | undefined>): string {
  return sections.filter((section): section is string => Boolean(section?.trim())).join('\n\n')
}
