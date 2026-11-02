import { defaultMentionTargetForMessage, parseGroupMentions, roleMentionLabel, roleMentionLabelOptionsFromSettings, roleModelLabel } from '../group/mentionParser'
import type { GroupChat, GroupMessage, GroupRole, MessageAttachmentDraft, MessageReference, OpenTeamStore } from '../group/types'
import type { ImageAttachmentRepository } from '../shared/imageAttachmentRepository'
import type { PendingComposerAttachment, TeamPageState } from './appState'
import { getVisibleThinkingRoles, shouldAutoReconnectRole, shouldConfirmMentionWithEnter, shouldSendMessageWithEnter } from './chatExperience'
import { runCommandWithReconnect } from './sendWithReconnect'

export interface ComposerViewDependencies {
  state: TeamPageState
  composerFormEl: HTMLFormElement
  targetPreviewEl: HTMLElement
  busyPreviewEl: HTMLElement
  sendButtonEl: HTMLButtonElement
  messageInputEl: HTMLTextAreaElement
  attachFileButtonEl: HTMLButtonElement
  attachmentInputEl: HTMLInputElement
  attachmentDraftEl: HTMLElement
  attachmentRepository: ImageAttachmentRepository
  referenceDraftEl: HTMLElement
  mentionPanelEl: HTMLElement
  getStore(): OpenTeamStore
  getCurrentChat(): GroupChat | undefined
  getCurrentRoles(): GroupRole[]
  roleToneClass(seed: string | undefined): string
  roleAvatarLabel(name: string | undefined): string
  reconnectRolesForSend(chat: GroupChat, roles: GroupRole[]): Promise<void>
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  showError(message: string): void
}

export interface ComposerView {
  renderComposerState(): void
  registerComposerEvents(): void
  insertMention(role: GroupRole): void
  setReference(message: GroupMessage): void
  submitComposerMessage(): Promise<void>
}

type MentionOption =
  | { type: 'all' }
  | { type: 'role'; role: GroupRole }

const MAX_COMPOSER_ATTACHMENTS = 10
const MAX_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_TEXT_BYTES = 1024 * 1024
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'])
const TEXT_EXTENSIONS = ['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.yml', '.yaml', '.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.go', '.rs', '.c', '.h', '.cpp', '.html', '.css', '.xml', '.sql', '.sh']

export function createComposerView(deps: ComposerViewDependencies): ComposerView {
  function mentionLabelOptions() {
    return mentionLabelOptionsFromStore(deps.getStore())
  }

  function roleDisplayName(role: GroupRole): string {
    return roleMentionLabel(role, mentionLabelOptions())
  }

  function renderComposerState(): void {
    const chat = deps.getCurrentChat()
    if (chat) pruneStaleAttachments(chat.id)
    renderReferenceDraft()
    renderMentionPanel()
    renderAttachmentDraft()

    const roles = deps.getCurrentRoles()
    const raw = deps.messageInputEl.value.trim()
    const hasAttachments = deps.state.pendingComposerAttachments.length > 0
    const parsed = parseGroupMentions(raw || (hasAttachments ? 'x' : ''), roles, { ...mentionLabelOptions(), defaultTarget: chat ? defaultMentionTargetForMessage(raw, chat) : 'none', allowEmpty: hasAttachments })
    const targetRoleIds = (raw || hasAttachments) && parsed.ok ? parsed.targetRoleIds : []
    const targets = roles.filter(role => targetRoleIds.includes(role.id))
    const unavailable = targets.filter(role => role.status !== 'ready')
    const reconnecting = targets.filter(role => deps.state.reconnectingRoleKeys.has(teamRoleKey(role.chatId, role.id)))
    const thinking = getVisibleThinkingRoles(roles)

    if (!chat) {
      deps.targetPreviewEl.textContent = '选择群聊后可发送'
      deps.sendButtonEl.disabled = true
    } else if (roles.length === 0) {
      deps.targetPreviewEl.textContent = '当前群聊还没有人员'
      deps.sendButtonEl.disabled = true
    } else if (!raw && !hasAttachments) {
      deps.targetPreviewEl.textContent = defaultMentionTargetForMessage('', chat) === 'all'
        ? '输入消息；不 @ 会让所有成员回复，也可 @ 指定成员'
        : '输入消息；不 @ 仅记录，@ 人员触发回复'
      deps.sendButtonEl.disabled = true
    } else if (!parsed.ok) {
      deps.targetPreviewEl.textContent = parsed.error
      deps.sendButtonEl.disabled = true
    } else if (targets.length === 0) {
      deps.targetPreviewEl.textContent = '将作为群消息记录，不触发 AI；@ 人员可触发回复'
      deps.sendButtonEl.disabled = false
    } else if (reconnecting.length > 0) {
      const readyTargets = targets.filter(role => !reconnecting.includes(role) && role.status === 'ready')
      deps.targetPreviewEl.textContent = readyTargets.length > 0
        ? `将发送给：${readyTargets.map(roleDisplayName).join('、')}；正在连接：${reconnecting.map(roleDisplayName).join('、')}`
        : `正在自动连接：${reconnecting.map(roleDisplayName).join('、')}`
      deps.sendButtonEl.disabled = readyTargets.length === 0
    } else if (unavailable.length > 0) {
      const waiting = unavailable.filter(role => !shouldAutoReconnectRole(role))
      const readyTargets = targets.filter(role => role.status === 'ready')
      if (waiting.length > 0 && readyTargets.length === 0) {
        deps.targetPreviewEl.textContent = `请稍等：${waiting.map(roleDisplayName).join('、')} 正在回复`
        deps.sendButtonEl.disabled = true
      } else if (waiting.length > 0) {
        deps.targetPreviewEl.textContent = `将发送给：${readyTargets.map(roleDisplayName).join('、')}；跳过正在回复：${waiting.map(roleDisplayName).join('、')}`
        deps.sendButtonEl.disabled = false
      } else {
        deps.targetPreviewEl.textContent = `将先自动连接：${unavailable.map(roleDisplayName).join('、')}`
        deps.sendButtonEl.disabled = false
      }
    } else {
      deps.targetPreviewEl.textContent = `将发送给：${targets.map(roleDisplayName).join('、')}`
      deps.sendButtonEl.disabled = false
    }

    deps.busyPreviewEl.textContent = thinking.length > 0 ? `正在回复：${thinking.map(roleDisplayName).join('、')}` : ''
  }

  function renderReferenceDraft(): void {
    deps.referenceDraftEl.replaceChildren()
    if (!deps.state.selectedReference) {
      deps.referenceDraftEl.hidden = true
      return
    }

    deps.referenceDraftEl.hidden = false
    const preview = document.createElement('div')
    preview.className = 'reference-draft-preview'
    preview.textContent = `引用 ${deps.state.selectedReference.roleName || '人员'}：${deps.state.selectedReference.contentSnapshot}`

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'btn btn-ghost'
    cancel.setAttribute('aria-label', '取消引用')
    cancel.textContent = '×'
    cancel.addEventListener('click', () => {
      deps.state.selectedReference = undefined
      renderComposerState()
    })
    deps.referenceDraftEl.append(preview, cancel)
  }

  function pruneStaleAttachments(chatId: string): void {
    const stale = deps.state.pendingComposerAttachments.filter(attachment => attachment.chatId !== chatId)
    if (stale.length === 0) return
    for (const attachment of stale) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
    deps.state.pendingComposerAttachments = deps.state.pendingComposerAttachments.filter(attachment => attachment.chatId === chatId)
    deps.attachmentRepository.deleteByIds(stale.map(attachment => attachment.id)).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
  }

  function renderAttachmentDraft(): void {
    const attachments = deps.state.pendingComposerAttachments
    deps.attachmentDraftEl.replaceChildren()
    if (attachments.length === 0) {
      deps.attachmentDraftEl.hidden = true
      return
    }

    deps.attachmentDraftEl.hidden = false
    for (const attachment of attachments) {
      const chip = document.createElement('div')
      chip.className = 'attachment-chip'
      if (attachment.kind === 'image' && attachment.previewUrl) {
        const thumb = document.createElement('img')
        thumb.className = 'attachment-chip-thumb'
        thumb.src = attachment.previewUrl
        thumb.alt = attachment.fileName
        chip.append(thumb)
      } else {
        const icon = document.createElement('span')
        icon.className = 'attachment-chip-icon'
        icon.textContent = attachment.kind === 'text' ? 'TXT' : 'FILE'
        chip.append(icon)
      }

      const name = document.createElement('span')
      name.className = 'attachment-chip-name'
      name.textContent = attachment.fileName
      name.title = attachment.fileName
      const size = document.createElement('span')
      size.className = 'attachment-chip-size'
      size.textContent = formatFileSize(attachment.size)
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'attachment-chip-remove'
      remove.setAttribute('aria-label', `移除附件 ${attachment.fileName}`)
      remove.textContent = '×'
      remove.addEventListener('click', () => removeAttachment(attachment.id))
      chip.append(name, size, remove)
      deps.attachmentDraftEl.append(chip)
    }
  }

  function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function removeAttachment(id: string): void {
    const index = deps.state.pendingComposerAttachments.findIndex(attachment => attachment.id === id)
    if (index < 0) return
    const [removed] = deps.state.pendingComposerAttachments.splice(index, 1)
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
    deps.attachmentRepository.deleteByIds([id]).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    renderComposerState()
  }

  async function addFiles(files: File[]): Promise<void> {
    const chat = deps.getCurrentChat()
    if (!chat) {
      deps.showError('请先选择群聊再添加附件')
      return
    }
    const room = MAX_COMPOSER_ATTACHMENTS - deps.state.pendingComposerAttachments.length
    if (room <= 0) {
      deps.showError(`一条消息最多添加 ${MAX_COMPOSER_ATTACHMENTS} 个附件`)
      return
    }
    if (files.length > room) deps.showError(`一条消息最多添加 ${MAX_COMPOSER_ATTACHMENTS} 个附件，已忽略超出部分`)

    for (const file of files.slice(0, room)) {
      const kind = classifyAttachment(file)
      if (!kind) {
        deps.showError(`不支持的附件类型：${file.name}`)
        continue
      }
      const limit = kind === 'image' ? MAX_IMAGE_BYTES : kind === 'text' ? MAX_TEXT_BYTES : MAX_DOCUMENT_BYTES
      if (file.size > limit) {
        deps.showError(`附件过大：${file.name}（上限 ${formatFileSize(limit)}）`)
        continue
      }
      const id = newAttachmentId()
      const mimeType = file.type || 'application/octet-stream'
      try {
        await deps.attachmentRepository.put({
          id,
          chatId: chat.id,
          messageId: 'pending',
          blob: file,
          mimeType,
          size: file.size,
          fileName: file.name,
          createdAt: Date.now(),
        })
      } catch (error) {
        deps.showError(`附件保存失败：${error instanceof Error ? error.message : String(error)}`)
        continue
      }
      deps.state.pendingComposerAttachments.push({
        id,
        chatId: chat.id,
        kind,
        fileName: file.name,
        mimeType,
        size: file.size,
        previewUrl: kind === 'image' ? URL.createObjectURL(file) : undefined,
      })
    }
    renderComposerState()
  }

  function classifyAttachment(file: File): PendingComposerAttachment['kind'] | undefined {
    if (IMAGE_MIME_TYPES.has(file.type)) return 'image'
    const lowerName = file.name.toLowerCase()
    if (file.type.startsWith('text/') || file.type === 'application/json' || TEXT_EXTENSIONS.some(extension => lowerName.endsWith(extension))) return 'text'
    return 'document'
  }

  function newAttachmentId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return `att-${crypto.randomUUID()}`
    return `att-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }

  function renderMentionPanel(): void {
    const roles = deps.getCurrentRoles()
    const show = shouldShowMentionPanel(deps.messageInputEl.value) && roles.length > 0
    const options = createMentionOptions(roles)
    deps.state.mentionIndex = clampMentionIndex(deps.state.mentionIndex, options)
    deps.mentionPanelEl.hidden = !show
    deps.mentionPanelEl.replaceChildren()
    if (!show) return

    options.forEach((mentionOption, index) => {
      const option = document.createElement('button')
      option.type = 'button'
      option.className = `mention-option${index === deps.state.mentionIndex ? ' active' : ''}`
      const avatar = document.createElement('span')
      const name = document.createElement('span')
      name.className = 'mention-name'
      const site = document.createElement('span')
      site.className = 'mention-site-badge'
      if (mentionOption.type === 'all') {
        avatar.className = 'mention-avatar mention-avatar-all'
        avatar.textContent = '全'
        name.textContent = '所有人'
        site.textContent = '全员'
        option.addEventListener('click', () => insertAllMention())
      } else {
        const role = mentionOption.role
        avatar.className = `mention-avatar ${deps.roleToneClass(role.name)}`
        avatar.textContent = deps.roleAvatarLabel(role.name)
        name.textContent = role.name
        site.className = `mention-site-badge ${role.modelSource === 'external' ? 'site-pill-external' : `site-pill-${role.chatSite ?? 'gemini'}`}`
        site.textContent = roleModelLabel(role, mentionLabelOptions())
        option.addEventListener('click', () => insertMention(role))
      }
      option.append(avatar, name, site)
      deps.mentionPanelEl.append(option)
    })
  }

  function registerComposerEvents(): void {
    deps.attachFileButtonEl.addEventListener('click', () => deps.attachmentInputEl.click())
    deps.attachmentInputEl.addEventListener('change', () => {
      const files = [...(deps.attachmentInputEl.files ?? [])]
      deps.attachmentInputEl.value = ''
      if (files.length > 0) void addFiles(files).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })
    deps.composerFormEl.addEventListener('dragover', event => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
      }
    })
    deps.composerFormEl.addEventListener('drop', event => {
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      void addFiles(files).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })
    deps.messageInputEl.addEventListener('paste', event => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.length === 0) return
      event.preventDefault()
      void addFiles(files).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })

    deps.composerFormEl.addEventListener('submit', event => {
      event.preventDefault()
      if (deps.sendButtonEl.disabled && deps.state.reconnectingRoleKeys.size > 0) return
      submitComposerMessage().catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })

    deps.messageInputEl.addEventListener('input', () => {
      deps.state.mentionIndex = 0
      renderComposerState()
    })
    deps.messageInputEl.addEventListener('keyup', () => renderComposerState())
    deps.messageInputEl.addEventListener('keydown', event => {
      const roles = deps.getCurrentRoles()
      const mentionOptions = createMentionOptions(roles)
      const canHandleMention = roles.length > 0 && (shouldShowMentionPanel(deps.messageInputEl.value) || !deps.mentionPanelEl.hidden)
      if (canHandleMention) {
        deps.state.mentionIndex = clampMentionIndex(deps.state.mentionIndex, mentionOptions)
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          deps.state.mentionIndex = (deps.state.mentionIndex + 1) % mentionOptions.length
          renderMentionPanel()
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          deps.state.mentionIndex = (deps.state.mentionIndex - 1 + mentionOptions.length) % mentionOptions.length
          renderMentionPanel()
        } else if (shouldConfirmMentionWithEnter(event)) {
          event.preventDefault()
          const mentionOption = mentionOptions[deps.state.mentionIndex]
          if (mentionOption?.type === 'all') insertAllMention()
          if (mentionOption?.type === 'role') insertMention(mentionOption.role)
        } else if (event.key === 'Escape') {
          deps.mentionPanelEl.hidden = true
        }
        return
      }

      if (shouldSendMessageWithEnter(event)) {
        event.preventDefault()
        deps.composerFormEl.requestSubmit()
      }
    })
  }

  async function submitComposerMessage(): Promise<void> {
    const chat = deps.getCurrentChat()
    const raw = deps.messageInputEl.value.trim()
    const pending = [...deps.state.pendingComposerAttachments]
    if (!chat || (!raw && pending.length === 0)) return

    const targetResult = resolveMessageTargets(raw, deps.getCurrentRoles(), pending.length > 0)
    if (!targetResult.ok) {
      deps.showError(targetResult.error)
      return
    }

    const waitingRoles = targetResult.roles.filter(role => role.status === 'thinking' && !shouldAutoReconnectRole(role))
    const readyRoles = targetResult.roles.filter(role => role.status === 'ready')
    if (waitingRoles.length > 0 && readyRoles.length === 0) {
      deps.showError(`请等待人员回复完成：${waitingRoles.map(roleDisplayName).join('、')}`)
      return
    }

    const reference = deps.state.selectedReference
    const drafts: MessageAttachmentDraft[] = pending.map(attachment => ({
      id: attachment.id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      size: attachment.size,
    }))
    clearComposerAfterSend(raw, reference)
    try {
      await runCommandWithReconnect(deps, { chat, roles: targetResult.roles, type: 'GROUP_MESSAGE_SEND', payload: { chatId: chat.id, raw, reference, attachments: drafts } })
    } catch (error) {
      restoreComposerDraft(raw, reference, pending)
      throw error
    }
    disposePendingAttachments(pending)
    renderComposerState()
  }

  function clearComposerAfterSend(raw: string, reference: MessageReference | undefined): void {
    if (deps.messageInputEl.value.trim() === raw) deps.messageInputEl.value = ''
    if (deps.state.selectedReference === reference) deps.state.selectedReference = undefined
    renderComposerState()
  }

  function restoreComposerDraft(raw: string, reference: MessageReference | undefined, pending: PendingComposerAttachment[]): void {
    if (!deps.messageInputEl.value.trim()) deps.messageInputEl.value = raw
    if (!deps.state.selectedReference) deps.state.selectedReference = reference
    if (deps.state.pendingComposerAttachments.length === 0) deps.state.pendingComposerAttachments = pending
    renderComposerState()
  }

  function disposePendingAttachments(attachments: PendingComposerAttachment[]): void {
    const ids = new Set(attachments.map(attachment => attachment.id))
    for (const attachment of attachments) {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
    }
    deps.state.pendingComposerAttachments = deps.state.pendingComposerAttachments.filter(attachment => !ids.has(attachment.id))
  }

  function setReference(message: GroupMessage): void {
    deps.state.selectedReference = {
      messageId: message.id,
      roleId: message.roleId,
      roleName: message.roleName,
      contentSnapshot: message.content,
    }
    deps.messageInputEl.focus()
    renderComposerState()
  }

  function resolveMessageTargets(raw: string, roles: GroupRole[], allowEmpty = false): { ok: true; roles: GroupRole[] } | { ok: false; error: string } {
    const chat = deps.getCurrentChat()
    const parsed = parseGroupMentions(raw, roles, { ...mentionLabelOptions(), defaultTarget: chat ? defaultMentionTargetForMessage(raw, chat) : 'none', allowEmpty })
    if (!parsed.ok) return { ok: false, error: parsed.error }
    const targets = roles.filter(role => parsed.targetRoleIds.includes(role.id))
    return { ok: true, roles: targets }
  }

  function shouldShowMentionPanel(value: string): boolean {
    const cursor = deps.messageInputEl.selectionStart ?? value.length
    const beforeCursor = value.slice(0, cursor)
    const atIndex = beforeCursor.lastIndexOf('@')
    if (atIndex < 0) return false
    const mentionText = beforeCursor.slice(atIndex + 1)
    return !/\s/.test(mentionText)
  }

  function insertMention(role: GroupRole): void {
    insertMentionLabel(roleMentionLabel(role, mentionLabelOptions()))
  }

  function insertAllMention(): void {
    insertMentionLabel('所有人')
  }

  function insertMentionLabel(label: string): void {
    const value = deps.messageInputEl.value
    const cursor = deps.messageInputEl.selectionStart ?? value.length
    const beforeCursor = value.slice(0, cursor)
    const atIndex = beforeCursor.lastIndexOf('@')
    const rawPrefix = atIndex >= 0 ? value.slice(0, atIndex) : value.slice(0, cursor)
    const prefix = rawPrefix && !/\s$/.test(rawPrefix) ? `${rawPrefix} ` : rawPrefix
    const suffix = value.slice(cursor)
    const inserted = `${prefix}@${label} ${suffix}`
    deps.messageInputEl.value = inserted
    const nextCursor = prefix.length + label.length + 2
    deps.messageInputEl.setSelectionRange(nextCursor, nextCursor)
    deps.messageInputEl.focus()
    deps.mentionPanelEl.hidden = true
    renderComposerState()
  }

  return { renderComposerState, registerComposerEvents, insertMention, setReference, submitComposerMessage }
}

function createMentionOptions(roles: GroupRole[]): MentionOption[] {
  return [{ type: 'all' }, ...roles.map(role => ({ type: 'role' as const, role }))]
}

function clampMentionIndex(index: number, options: MentionOption[]): number {
  if (options.length === 0) return 0
  return Math.min(Math.max(0, index), options.length - 1)
}

function mentionLabelOptionsFromStore(store: OpenTeamStore) {
  return roleMentionLabelOptionsFromSettings(store.settings)
}

function teamRoleKey(chatId: string, roleId: string): string {
  return `${chatId}:${roleId}`
}
