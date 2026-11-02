import type { ChatSite, MessageReference, OpenTeamStore, RoleTemplate } from '../group/types'
import { createDefaultStore } from '../group/store'
import { OPENTEAM_CONTROL_DEFAULT_PORT, type OpenTeamControlConnectionStatus } from '../shared/localControlProtocol'

export type CachedMessageNode = { signature: string; node: HTMLElement; streamingSignature?: string }
export type TemporaryPersonDraft = Pick<RoleTemplate, 'name' | 'description' | 'systemPrompt'> & { id: string; chatSite: ChatSite }

export interface PendingComposerAttachment {
  id: string
  chatId: string
  kind: 'image' | 'text' | 'document'
  fileName: string
  mimeType: string
  size: number
  previewUrl?: string
}

export interface RoleReadyWaiter {
  chatId: string
  roleIds: Set<string>
  resolve: () => void
  reject: (error: Error) => void
  timeoutId: number
  pollTimeoutId?: number
}

export interface TeamPageState {
  store: OpenTeamStore
  controlStatus: OpenTeamControlConnectionStatus
  selectedChatId?: string
  selectedRoleId?: string
  selectedTemplateId?: string
  selectedReference?: MessageReference
  pendingComposerAttachments: PendingComposerAttachment[]
  hostTabId?: number
  mentionIndex: number
  peopleDrawerOpen: boolean
  chatMenuChatId?: string
  roleSiteMenuRoleId?: string
  roleActionMenuRoleId?: string
  addPersonSiteMenuId?: string
  notesPanelOpen: boolean
  activeNoteScope: 'global' | 'chat'
  peopleLibraryPage: number
  peopleLibraryTemplateType: 'builtin' | 'custom'
  peopleLibrarySearchQuery: string
  peopleLibraryCategory: string
  previewTemplateId?: string
  addPersonTemplateType: 'builtin' | 'custom'
  addPersonSearchQuery: string
  addPersonCategory: string
  pendingSwitchAnimationFrame?: number
  thinkingTimeoutTimers: number[]
  loggedThinkingTimeoutRoleIds: Set<string>
  messageNodeCache: Map<string, CachedMessageNode>
  preserveNextMessageScroll: boolean
  reconnectingRoleKeys: Set<string>
  roleReadyWaiters: Set<RoleReadyWaiter>
  temporaryPersonDrafts: TemporaryPersonDraft[]
  addPersonSiteByKey: Map<string, Set<string>>
  addPersonSelectedKeys: Set<string>
}

export function createTeamPageState(): TeamPageState {
  return {
    store: createDefaultStore(),
    controlStatus: { state: 'disabled', port: OPENTEAM_CONTROL_DEFAULT_PORT },
    mentionIndex: 0,
    pendingComposerAttachments: [],
    peopleDrawerOpen: false,
    thinkingTimeoutTimers: [],
    loggedThinkingTimeoutRoleIds: new Set<string>(),
    messageNodeCache: new Map<string, CachedMessageNode>(),
    preserveNextMessageScroll: false,
    reconnectingRoleKeys: new Set<string>(),
    roleReadyWaiters: new Set<RoleReadyWaiter>(),
    temporaryPersonDrafts: [],
    addPersonSiteByKey: new Map<string, Set<string>>(),
    addPersonSelectedKeys: new Set<string>(),
    peopleLibraryPage: 0,
    peopleLibraryTemplateType: 'custom',
    peopleLibrarySearchQuery: '',
    peopleLibraryCategory: '全部',
    addPersonTemplateType: 'custom',
    addPersonSearchQuery: '',
    addPersonCategory: '全部',
    notesPanelOpen: false,
    activeNoteScope: 'chat',
  }
}

export function pickSelectedChatId(state: TeamPageState): string | undefined {
  const store = state.store
  if (store.currentChatId && store.chatsById[store.currentChatId]) return store.currentChatId
  if (state.selectedChatId && store.chatsById[state.selectedChatId]) return state.selectedChatId
  return [...store.chatOrder]
    .sort((left, right) => (store.chatsById[right]?.updatedAt ?? 0) - (store.chatsById[left]?.updatedAt ?? 0))
    .find(chatId => Boolean(store.chatsById[chatId]))
}
