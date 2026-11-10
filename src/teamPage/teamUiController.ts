import { getDefaultChatSiteUrl } from '../group/conversationUrl'
import {
  GROUP_TEMPLATE_ALL_CATEGORY,
  buildBuiltinGroupTemplateWelcomeMessage,
  filterBuiltinGroupTemplates,
  getBuiltinGroupTemplate,
  getBuiltinGroupTemplateCategories,
  type BuiltinGroupTemplate,
} from '../group/builtinGroupTemplates'
import type { ChatSite, GroupChat, GroupRole, RoomMode } from '../group/types'
import { localizeCategory, localizeGroupTemplate, normalizeLanguage, translateUi, type TeamLanguage } from '../shared/i18n'
import type { TeamPageState } from './appState'
import { requireElement } from './domRefs'
import type { RoleFrameState } from './iframeHost'

interface TeamUiIframeHost {
  restoreChat(chat: GroupChat, roles: GroupRole[]): RoleFrameState[]
}

export interface TeamUiControllerDependencies {
  state: TeamPageState
  settingsButtonEl: HTMLButtonElement
  settingsMenuEl: HTMLElement
  quickCreateChatEl: HTMLButtonElement
  createChatFormEl: HTMLFormElement
  newChatNameEl: HTMLInputElement
  togglePeopleDrawerEl: HTMLButtonElement
  rolePanelEl: HTMLElement
  iframeHost: TeamUiIframeHost
  getLanguage(): TeamLanguage
  getCurrentChat(): GroupChat | undefined
  getCurrentRoles(): GroupRole[]
  getSelectedLoginSite(): ChatSite
  render(): void
  renderChatList(): void
  renderRolePanel(): void
  renderAddPersonDialog(): void
  closePeopleModals(): void
  closeExternalModels(): void
  registerComposerEvents(): void
  registerPeopleLibraryEvents(): void
  registerExternalModelsEvents(): void
  runCommand(type: string, payload?: Record<string, unknown>): Promise<void>
  showError(message: string): void
  log: {
    debug(event: string, details?: Record<string, unknown>): void
    info(event: string, details?: Record<string, unknown>): void
  }
}

export interface TeamUiController {
  registerUi(): void
}

const GROUP_TEMPLATE_INLINE_SUMMARY_LIMIT = 72

export function createTeamUiController(deps: TeamUiControllerDependencies): TeamUiController {
  let selectedGroupTemplateId: string | undefined
  let selectedGroupTemplateCategory = GROUP_TEMPLATE_ALL_CATEGORY
  let groupTemplateSearchQuery = ''

  function registerUi(): void {
    const openGroupTemplateCreateEl = requireElement<HTMLButtonElement>('#open-group-template-create')
    const groupTemplateModalEl = requireElement<HTMLElement>('#group-template-modal')
    const groupTemplateSearchEl = requireElement<HTMLInputElement>('#group-template-search')
    const groupTemplateCategoriesEl = requireElement<HTMLElement>('#group-template-categories')
    const groupTemplateListEl = requireElement<HTMLElement>('#group-template-list')
    const confirmGroupTemplateCreateEl = requireElement<HTMLButtonElement>('#confirm-group-template-create')
    const closeGroupTemplateModalEl = requireElement<HTMLButtonElement>('#close-group-template-modal')

    deps.quickCreateChatEl.addEventListener('click', () => {
      setChatCreatePopoverVisible(deps.createChatFormEl.hidden)
    })

    deps.settingsButtonEl.addEventListener('click', event => {
      event.stopPropagation()
      const visible = deps.settingsMenuEl.hidden
      deps.settingsMenuEl.hidden = !visible
      deps.settingsButtonEl.setAttribute('aria-expanded', String(visible))
      deps.log.debug('ui:settings-menu:open')
    })

    deps.registerPeopleLibraryEvents()
    deps.registerExternalModelsEvents()

    deps.togglePeopleDrawerEl.addEventListener('click', () => {
      deps.state.peopleDrawerOpen = !deps.state.peopleDrawerOpen
      deps.render()
    })

    requireElement<HTMLButtonElement>('#close-people-drawer').addEventListener('click', () => {
      deps.state.peopleDrawerOpen = false
      deps.render()
    })

    document.addEventListener('click', event => {
      const target = event.target as Element | null
      if (!deps.settingsMenuEl.hidden && !deps.settingsMenuEl.contains(event.target as Node) && event.target !== deps.settingsButtonEl) {
        deps.settingsMenuEl.hidden = true
        deps.settingsButtonEl.setAttribute('aria-expanded', 'false')
      }
      if (deps.state.peopleDrawerOpen && target && !deps.rolePanelEl.contains(target) && !deps.togglePeopleDrawerEl.contains(target)) {
        deps.state.peopleDrawerOpen = false
        deps.render()
      }
      if (deps.state.chatMenuChatId && !target?.closest('.chat-action-menu, .chat-menu-btn')) {
        deps.state.chatMenuChatId = undefined
        deps.renderChatList()
      }
      if (deps.state.roleSiteMenuRoleId && !target?.closest('.role-site-menu, .site-pill')) {
        deps.state.roleSiteMenuRoleId = undefined
        deps.renderRolePanel()
      }
      if (deps.state.addPersonSiteMenuId && !target?.closest('.role-site-menu, .site-pill')) {
        deps.state.addPersonSiteMenuId = undefined
        deps.renderAddPersonDialog()
      }
    })

    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return
      deps.settingsMenuEl.hidden = true
      deps.settingsButtonEl.setAttribute('aria-expanded', 'false')
      deps.closePeopleModals()
      deps.closeExternalModels()
      deps.state.chatMenuChatId = undefined
      deps.state.roleSiteMenuRoleId = undefined
      deps.state.roleActionMenuRoleId = undefined
      closeGroupTemplateModal(groupTemplateModalEl, groupTemplateSearchEl, groupTemplateCategoriesEl, groupTemplateListEl, confirmGroupTemplateCreateEl)
      if (!deps.createChatFormEl.hidden) setChatCreatePopoverVisible(false)
      const closedPeopleDrawer = deps.state.peopleDrawerOpen
      if (closedPeopleDrawer) deps.state.peopleDrawerOpen = false
      deps.renderChatList()
      deps.renderRolePanel()
      if (closedPeopleDrawer) deps.render()
    })

    requireElement<HTMLButtonElement>('#cancel-create-chat').addEventListener('click', () => {
      setChatCreatePopoverVisible(false)
    })

    openGroupTemplateCreateEl.addEventListener('click', () => {
      openGroupTemplateModal(groupTemplateModalEl, groupTemplateSearchEl, groupTemplateCategoriesEl, groupTemplateListEl, confirmGroupTemplateCreateEl)
    })

    closeGroupTemplateModalEl.addEventListener('click', () => {
      closeGroupTemplateModal(groupTemplateModalEl, groupTemplateSearchEl, groupTemplateCategoriesEl, groupTemplateListEl, confirmGroupTemplateCreateEl)
    })

    groupTemplateSearchEl.addEventListener('input', () => {
      groupTemplateSearchQuery = groupTemplateSearchEl.value
      syncGroupTemplateSelection(confirmGroupTemplateCreateEl)
      renderGroupTemplateList(groupTemplateListEl, confirmGroupTemplateCreateEl)
    })

    confirmGroupTemplateCreateEl.addEventListener('click', () => {
      const template = selectedGroupTemplateId ? getBuiltinGroupTemplate(selectedGroupTemplateId) : undefined
      if (!template) return
      const localizedTemplate = localizeGroupTemplate(template, language())
      deps.newChatNameEl.value = ''
      closeGroupTemplateModal(groupTemplateModalEl, groupTemplateSearchEl, groupTemplateCategoriesEl, groupTemplateListEl, confirmGroupTemplateCreateEl)
      setChatCreatePopoverVisible(false)
      deps.runCommand('GROUP_CHAT_CREATE', {
        name: localizedTemplate.defaultChatName,
        mode: localizedTemplate.defaultMode,
        roles: localizedTemplate.roles,
        welcomeMessage: buildBuiltinGroupTemplateWelcomeMessage(localizedTemplate, language()),
      }).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })

    deps.createChatFormEl.addEventListener('submit', event => {
      event.preventDefault()
      const name = deps.newChatNameEl.value.trim() || ui('新群聊')
      const mode = readNewChatMode()
      deps.newChatNameEl.value = ''
      setChatCreatePopoverVisible(false)
      deps.runCommand('GROUP_CHAT_CREATE', { name, mode, roles: [] }).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })

    requireElement<HTMLButtonElement>('#restore-chat').addEventListener('click', () => {
      const chat = deps.getCurrentChat()
      if (!chat) return
      const roles = deps.getCurrentRoles().filter(role => role.modelSource !== 'external')
      deps.log.info('ui:restore-chat', { chatId: chat.id, roleIds: roles.map(role => role.id) })
      const restoredFrames = deps.iframeHost.restoreChat({ ...chat, roleIds: roles.map(role => role.id) }, roles)
      const assignedRoleIds = new Set(restoredFrames.filter(frame => frame.status === 'assigned').map(frame => frame.roleId))
      const rolesToRecover = roles.filter(role => !assignedRoleIds.has(role.id))
      Promise.all(rolesToRecover.map(role => deps.runCommand('GROUP_ROLE_RECOVER', { chatId: chat.id, roleId: role.id }))).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })

    deps.registerComposerEvents()

    requireElement<HTMLButtonElement>('#open-gemini-login').addEventListener('click', () => {
      chrome.tabs.create({ url: getDefaultChatSiteUrl(deps.getSelectedLoginSite()) }).catch(error => deps.showError(error instanceof Error ? error.message : String(error)))
    })
  }

  function openGroupTemplateModal(
    modalEl: HTMLElement,
    searchEl: HTMLInputElement,
    categoriesEl: HTMLElement,
    listEl: HTMLElement,
    confirmButton: HTMLButtonElement,
  ): void {
    selectedGroupTemplateId = undefined
    selectedGroupTemplateCategory = GROUP_TEMPLATE_ALL_CATEGORY
    groupTemplateSearchQuery = ''
    searchEl.value = ''
    updateGroupTemplateConfirmButton(confirmButton)
    renderGroupTemplateCategories(categoriesEl, listEl, confirmButton)
    renderGroupTemplateList(listEl, confirmButton)
    modalEl.hidden = false
    searchEl.focus()
  }

  function closeGroupTemplateModal(
    modalEl: HTMLElement,
    searchEl: HTMLInputElement,
    categoriesEl: HTMLElement,
    listEl: HTMLElement,
    confirmButton: HTMLButtonElement,
  ): void {
    modalEl.hidden = true
    selectedGroupTemplateId = undefined
    selectedGroupTemplateCategory = GROUP_TEMPLATE_ALL_CATEGORY
    groupTemplateSearchQuery = ''
    searchEl.value = ''
    updateGroupTemplateConfirmButton(confirmButton)
    categoriesEl.replaceChildren()
    listEl.replaceChildren()
  }

  function renderGroupTemplateList(listEl: HTMLElement, confirmButton: HTMLButtonElement): void {
    listEl.replaceChildren()
    const templates = filteredGroupTemplates()
    if (templates.length === 0) {
      listEl.append(groupTemplateEmptyState(confirmButton))
      return
    }

    for (const template of templates) {
      listEl.append(groupTemplateOption(template, listEl, confirmButton))
    }
  }

  function renderGroupTemplateCategories(
    categoriesEl: HTMLElement,
    listEl: HTMLElement,
    confirmButton: HTMLButtonElement,
  ): void {
    categoriesEl.replaceChildren()
    for (const category of getBuiltinGroupTemplateCategories()) {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = `group-template-category-filter${selectedGroupTemplateCategory === category ? ' active' : ''}`
      button.textContent = localizeCategory(category, language()) ?? category
      button.setAttribute('aria-pressed', String(selectedGroupTemplateCategory === category))
      button.addEventListener('click', () => {
        selectedGroupTemplateCategory = category
        syncGroupTemplateSelection(confirmButton)
        renderGroupTemplateCategories(categoriesEl, listEl, confirmButton)
        renderGroupTemplateList(listEl, confirmButton)
      })
      categoriesEl.append(button)
    }
  }

  function groupTemplateOption(
    template: BuiltinGroupTemplate,
    listEl: HTMLElement,
    confirmButton: HTMLButtonElement,
  ): HTMLButtonElement {
    const displayTemplate = localizeGroupTemplate(template, language())
    const button = document.createElement('button')
    button.type = 'button'
    const hasLongSummary = displayTemplate.summary.length > GROUP_TEMPLATE_INLINE_SUMMARY_LIMIT
    button.className = [
      'group-template-option',
      selectedGroupTemplateId === template.id ? 'active' : '',
      hasLongSummary ? 'has-long-summary' : '',
    ].filter(Boolean).join(' ')
    button.dataset.templateId = template.id
    button.setAttribute('aria-pressed', String(selectedGroupTemplateId === template.id))
    button.addEventListener('click', () => {
      selectedGroupTemplateId = template.id
      updateGroupTemplateConfirmButton(confirmButton)
      renderGroupTemplateList(listEl, confirmButton)
      listEl.querySelector<HTMLButtonElement>(`[data-template-id="${template.id}"]`)?.focus()
    })

    const top = document.createElement('span')
    top.className = 'group-template-option-top'
    const heading = document.createElement('span')
    heading.className = 'group-template-heading'
    const titleRow = document.createElement('span')
    titleRow.className = 'group-template-title-row'
    const name = document.createElement('strong')
    name.textContent = displayTemplate.name
    titleRow.append(name)
    const risk = groupTemplateRiskLabel(template)
    if (risk) titleRow.append(risk)
    const count = document.createElement('span')
    count.className = 'group-template-role-count'
    count.textContent = ui(`${template.roles.length} 个角色`)
    heading.append(titleRow, count)
    const category = document.createElement('span')
    category.className = 'group-template-category'
    category.textContent = displayTemplate.category
    top.append(heading, category)

    const summary = document.createElement('span')
    summary.className = 'group-template-summary'
    summary.textContent = displayTemplate.summary
    if (hasLongSummary) summary.title = displayTemplate.summary

    const meta = document.createElement('span')
    meta.className = 'group-template-meta'
    meta.textContent = ui(`适用：${displayTemplate.userTypes.slice(0, 3).join(language() === 'en' ? ', ' : '、')}`)

    const roles = document.createElement('span')
    roles.className = 'group-template-roles'
    for (const role of displayTemplate.roles) {
      const chip = document.createElement('span')
      chip.textContent = role.name
      roles.append(chip)
    }

    button.append(top, summary, meta, roles)
    return button
  }

  function groupTemplateEmptyState(confirmButton: HTMLButtonElement): HTMLElement {
    updateGroupTemplateConfirmButton(confirmButton)
    const empty = document.createElement('div')
    empty.className = 'group-template-empty'

    const title = document.createElement('strong')
    title.textContent = ui('没有找到匹配的小组')
    const description = document.createElement('p')
    description.textContent = ui('可以试试换个说法，例如搜索「写论文」「合同」「面试」「投放」「装修」。')
    const actions = document.createElement('div')
    actions.className = 'group-template-empty-actions'

    const clearSearch = document.createElement('button')
    clearSearch.type = 'button'
    clearSearch.className = 'btn btn-ghost'
    clearSearch.textContent = ui('清空搜索')
    clearSearch.addEventListener('click', () => {
      const searchEl = requireElement<HTMLInputElement>('#group-template-search')
      groupTemplateSearchQuery = ''
      searchEl.value = ''
      syncGroupTemplateSelection(confirmButton)
      renderGroupTemplateList(requireElement<HTMLElement>('#group-template-list'), confirmButton)
      searchEl.focus()
    })

    const showAll = document.createElement('button')
    showAll.type = 'button'
    showAll.className = 'btn btn-ghost'
    showAll.textContent = ui('查看全部模板')
    showAll.addEventListener('click', () => {
      const searchEl = requireElement<HTMLInputElement>('#group-template-search')
      const categoriesEl = requireElement<HTMLElement>('#group-template-categories')
      const listEl = requireElement<HTMLElement>('#group-template-list')
      selectedGroupTemplateCategory = GROUP_TEMPLATE_ALL_CATEGORY
      groupTemplateSearchQuery = ''
      searchEl.value = ''
      syncGroupTemplateSelection(confirmButton)
      renderGroupTemplateCategories(categoriesEl, listEl, confirmButton)
      renderGroupTemplateList(listEl, confirmButton)
      searchEl.focus()
    })

    actions.append(clearSearch, showAll)
    empty.append(title, description, actions)
    return empty
  }

  function groupTemplateRiskLabel(template: BuiltinGroupTemplate): HTMLElement | undefined {
    if (template.riskLevel === 'normal') return undefined
    const label = document.createElement('span')
    label.className = `group-template-risk group-template-risk-${template.riskLevel}`
    label.textContent = ui(template.riskLevel === 'professional' ? '专业边界' : '需谨慎')
    return label
  }

  function syncGroupTemplateSelection(confirmButton: HTMLButtonElement): void {
    if (!selectedGroupTemplateId) {
      updateGroupTemplateConfirmButton(confirmButton)
      return
    }
    const visible = filteredGroupTemplates().some(template => template.id === selectedGroupTemplateId)
    if (!visible) selectedGroupTemplateId = undefined
    updateGroupTemplateConfirmButton(confirmButton)
  }

  function updateGroupTemplateConfirmButton(confirmButton: HTMLButtonElement): void {
    const template = selectedGroupTemplateId ? getBuiltinGroupTemplate(selectedGroupTemplateId) : undefined
    confirmButton.disabled = !template
    confirmButton.textContent = ui(template?.riskLevel === 'professional' ? '了解限制并创建' : '确认创建')
  }

  function filteredGroupTemplates(): BuiltinGroupTemplate[] {
    const query = groupTemplateSearchQuery.trim().toLowerCase()
    const byCategory = filterBuiltinGroupTemplates({ category: selectedGroupTemplateCategory })
    if (!query) return byCategory
    const rawMatches = new Set(filterBuiltinGroupTemplates({
      category: selectedGroupTemplateCategory,
      query: groupTemplateSearchQuery,
    }).map(template => template.id))
    return byCategory.filter(template => rawMatches.has(template.id) || localizedGroupSearchText(template).includes(query))
  }

  function localizedGroupSearchText(template: BuiltinGroupTemplate): string {
    const displayTemplate = localizeGroupTemplate(template, language())
    return [
      displayTemplate.name,
      displayTemplate.category,
      displayTemplate.summary,
      ...displayTemplate.userTypes,
      ...displayTemplate.aliases,
      ...displayTemplate.roles.flatMap(role => [role.name, role.description, role.systemPrompt]),
    ].join('\n').toLowerCase()
  }

  function language(): TeamLanguage {
    return normalizeLanguage(deps.getLanguage())
  }

  function ui(source: string): string {
    return translateUi(source, language())
  }

  function readNewChatMode(): RoomMode {
    const selected = document.querySelector<HTMLInputElement>('input[name="new-chat-mode"]:checked')
    return selected?.value === 'collaborative' ? 'collaborative' : 'independent'
  }

  function setChatCreatePopoverVisible(visible: boolean): void {
    deps.createChatFormEl.hidden = !visible
    deps.quickCreateChatEl.setAttribute('aria-expanded', String(visible))
    if (visible) deps.newChatNameEl.focus()
  }

  return { registerUi }
}
