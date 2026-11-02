import type { SiteStatus } from '../../group/runtimeProtocol'
import type { PromptAttachmentPayload, ReplyImageSource } from '../../group/types'

export interface SiteStatusInfo {
  status: SiteStatus
  detail?: string
  timestamp: number
}

export interface ConversationSnapshot {
  conversationId?: string
  conversationUrl?: string
}

export interface ChatSiteAdapter {
  readonly id: string
  getConversationSnapshot(): ConversationSnapshot
  getConversationId(): string
  getResponseContainers(): Element[]
  getAllAssistantReplies(): string[]
  readResponseText(node: Node): string
  readResponseImages?(node: Node): ReplyImageSource[]
  readResponseTextFromCopy?(node: Node): Promise<string | undefined>
  readResponseMarkdown?(node: Node): string
  findResponseContainer(element: Element | null): Element | null
  isGenerating(): boolean
  checkStatus?(): SiteStatusInfo
  stopGenerating(): Promise<boolean>
  fillAndSend(content: string, autoSend?: boolean): Promise<void>
  /** Whether this site can accept user files through its native upload control. */
  readonly supportsFileUpload?: boolean
  uploadAttachments?(attachments: PromptAttachmentPayload[]): Promise<void>
  collectPromptDiagnostics(): Record<string, unknown>
}
