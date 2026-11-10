export interface FloatingWindowDependencies {
  appShellEl: HTMLElement
  closeWindowEl?: HTMLButtonElement
  toggleWindowSizeEl: HTMLButtonElement
  toggleFullscreenEl: HTMLButtonElement
  windowLauncherEl: HTMLButtonElement
  windowResizeHandleEl?: HTMLButtonElement
}

export interface FloatingWindowControls {
  registerFloatingWindowControls(): void
  setWindowMinimized(minimized: boolean): void
}

export function createFloatingWindowControls(deps: FloatingWindowDependencies): FloatingWindowControls {
  const dragZoneHeight = 52
  const margin = 8
  const minShellWidth = 760
  const minShellHeight = 520
  let minimizedFromFullscreen = false

  function ensureShellPositioned(): DOMRect {
    const rect = deps.appShellEl.getBoundingClientRect()
    deps.appShellEl.style.left = `${rect.left}px`
    deps.appShellEl.style.top = `${rect.top}px`
    deps.appShellEl.style.transform = 'none'
    return rect
  }

  function moveShellTo(left: number, top: number): void {
    const rect = deps.appShellEl.getBoundingClientRect()
    const maxLeft = Math.max(margin, window.innerWidth - Math.min(rect.width, window.innerWidth - margin * 2) - margin)
    const maxTop = Math.max(margin, window.innerHeight - Math.min(rect.height, window.innerHeight - margin * 2) - margin)
    deps.appShellEl.style.left = `${Math.min(Math.max(margin, left), maxLeft)}px`
    deps.appShellEl.style.top = `${Math.min(Math.max(margin, top), maxTop)}px`
    deps.appShellEl.style.transform = 'none'
  }

  function resizeShellTo(width: number, height: number): void {
    const maxWidth = Math.max(minShellWidth, window.innerWidth - margin * 2)
    const maxHeight = Math.max(minShellHeight, window.innerHeight - margin * 2)
    deps.appShellEl.style.width = `${Math.min(Math.max(minShellWidth, width), maxWidth)}px`
    deps.appShellEl.style.height = `${Math.min(Math.max(minShellHeight, height), maxHeight)}px`
    window.requestAnimationFrame(clampShellPosition)
  }

  function clampShellPosition(): void {
    if (deps.appShellEl.classList.contains('fullscreen')) return
    if (deps.appShellEl.style.transform !== 'none') return

    const rect = deps.appShellEl.getBoundingClientRect()
    moveShellTo(rect.left, rect.top)
  }

  function setWindowMinimized(minimized: boolean): void {
    if (minimized) {
      // 记住缩到角落之前是否是满屏工作台，恢复时回到同一个单层布局，
      // 避免用户从启动器回来时突然变成"浮窗盖在站点墙上"的两层页面。
      minimizedFromFullscreen = deps.appShellEl.classList.contains('fullscreen')
      setWindowFullscreen(false)
    }
    if (!minimized) {
      setWindowFullscreen(minimizedFromFullscreen)
      minimizedFromFullscreen = false
    }
    if (!minimized && deps.appShellEl.style.transform !== 'none') ensureShellPositioned()
    deps.appShellEl.classList.toggle('minimized', minimized)
    deps.windowLauncherEl.hidden = !minimized
    deps.toggleWindowSizeEl.textContent = minimized ? '□' : '−'
    deps.toggleWindowSizeEl.setAttribute('aria-expanded', String(!minimized))
    if (!minimized) window.requestAnimationFrame(clampShellPosition)
  }

  function setWindowFullscreen(fullscreen: boolean): void {
    if (fullscreen) {
      deps.appShellEl.style.left = ''
      deps.appShellEl.style.top = ''
      deps.appShellEl.style.transform = ''
      deps.appShellEl.classList.remove('minimized')
      deps.windowLauncherEl.hidden = true
      deps.toggleWindowSizeEl.textContent = '−'
      deps.toggleWindowSizeEl.setAttribute('aria-expanded', 'true')
    }
    deps.appShellEl.classList.toggle('fullscreen', fullscreen)
    deps.toggleFullscreenEl.textContent = fullscreen ? '⤡' : '⛶'
    deps.toggleFullscreenEl.setAttribute('aria-pressed', String(fullscreen))
    deps.toggleFullscreenEl.setAttribute('aria-label', fullscreen ? '退出全屏' : '全屏窗口')
    deps.toggleFullscreenEl.title = fullscreen ? '退出全屏' : '全屏窗口'
  }

  function registerFloatingWindowControls(): void {
    let dragOffsetX = 0
    let dragOffsetY = 0
    let activePointerId: number | undefined
    let resizeStartX = 0
    let resizeStartY = 0
    let resizeStartWidth = 0
    let resizeStartHeight = 0
    let activeResizePointerId: number | undefined

    deps.appShellEl.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      if (deps.appShellEl.classList.contains('fullscreen')) return
      if (!isTopChromeDragEvent(event)) return

      const rect = ensureShellPositioned()
      dragOffsetX = event.clientX - rect.left
      dragOffsetY = event.clientY - rect.top
      activePointerId = event.pointerId
      deps.appShellEl.classList.add('dragging')
      deps.appShellEl.setPointerCapture(event.pointerId)
      event.preventDefault()
    })

    deps.appShellEl.addEventListener('pointermove', event => {
      if (activePointerId !== event.pointerId) return
      moveShellTo(event.clientX - dragOffsetX, event.clientY - dragOffsetY)
    })

    function stopDragging(event: PointerEvent): void {
      if (activePointerId !== event.pointerId) return
      activePointerId = undefined
      deps.appShellEl.classList.remove('dragging')
      if (deps.appShellEl.hasPointerCapture(event.pointerId)) deps.appShellEl.releasePointerCapture(event.pointerId)
    }

    deps.appShellEl.addEventListener('pointerup', stopDragging)
    deps.appShellEl.addEventListener('pointercancel', stopDragging)
    deps.windowResizeHandleEl?.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      if (deps.appShellEl.classList.contains('fullscreen') || deps.appShellEl.classList.contains('minimized')) return

      const rect = ensureShellPositioned()
      resizeStartX = event.clientX
      resizeStartY = event.clientY
      resizeStartWidth = rect.width
      resizeStartHeight = rect.height
      activeResizePointerId = event.pointerId
      deps.appShellEl.classList.add('resizing')
      deps.windowResizeHandleEl?.setPointerCapture(event.pointerId)
      event.preventDefault()
      event.stopPropagation()
    })
    deps.windowResizeHandleEl?.addEventListener('pointermove', event => {
      if (activeResizePointerId !== event.pointerId) return
      resizeShellTo(resizeStartWidth + event.clientX - resizeStartX, resizeStartHeight + event.clientY - resizeStartY)
    })

    function stopResizing(event: PointerEvent): void {
      if (activeResizePointerId !== event.pointerId) return
      activeResizePointerId = undefined
      deps.appShellEl.classList.remove('resizing')
      if (deps.windowResizeHandleEl?.hasPointerCapture(event.pointerId)) deps.windowResizeHandleEl.releasePointerCapture(event.pointerId)
    }

    deps.windowResizeHandleEl?.addEventListener('pointerup', stopResizing)
    deps.windowResizeHandleEl?.addEventListener('pointercancel', stopResizing)
    deps.closeWindowEl?.addEventListener('click', () => setWindowMinimized(true))
    deps.toggleWindowSizeEl.addEventListener('click', () => setWindowMinimized(!deps.appShellEl.classList.contains('minimized')))
    deps.toggleFullscreenEl.addEventListener('click', () => setWindowFullscreen(!deps.appShellEl.classList.contains('fullscreen')))
    setWindowFullscreen(deps.appShellEl.classList.contains('fullscreen'))
    deps.windowLauncherEl.addEventListener('click', () => setWindowMinimized(false))
    window.addEventListener('resize', clampShellPosition)
  }

  function isTopChromeDragEvent(event: PointerEvent): boolean {
    const target = event.target as Element | null
    if (target?.closest('button, input, textarea, select, a, [role="button"], .settings-menu, .modal')) return false
    const rect = deps.appShellEl.getBoundingClientRect()
    return event.clientY - rect.top <= dragZoneHeight
  }

  return { registerFloatingWindowControls, setWindowMinimized }
}
