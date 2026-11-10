// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFloatingWindowControls } from './floatingWindow'

describe('team page floating window boundary', () => {
  it('keeps drag and minimize controls outside the entrypoint', () => {
    const entrySource = readFileSync(resolve(process.cwd(), 'src/teamPage/index.ts'), 'utf8')
    const viewSource = readFileSync(resolve(process.cwd(), 'src/teamPage/floatingWindow.ts'), 'utf8')

    expect(viewSource).toContain('function ensureShellPositioned(): DOMRect')
    expect(viewSource).toContain('function moveShellTo(left: number, top: number): void')
    expect(viewSource).toContain('function resizeShellTo(width: number, height: number): void')
    expect(viewSource).toContain('function clampShellPosition(): void')
    expect(viewSource).toContain('function setWindowMinimized(minimized: boolean): void')
    expect(viewSource).toContain('function registerFloatingWindowControls(): void')
    expect(entrySource).not.toContain('function ensureShellPositioned(): DOMRect')
    expect(entrySource).not.toContain('function moveShellTo(left: number, top: number): void')
    expect(entrySource).not.toContain('function resizeShellTo(width: number, height: number): void')
    expect(entrySource).not.toContain('function clampShellPosition(): void')
    expect(entrySource).not.toContain('function registerFloatingWindowControls(): void')
  })

  it('toggles fullscreen mode from the floating toolbar', () => {
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')

    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    toggleFullscreenEl.click()

    expect(appShellEl.classList.contains('fullscreen')).toBe(true)
    expect(toggleFullscreenEl.getAttribute('aria-pressed')).toBe('true')
    expect(toggleFullscreenEl.getAttribute('aria-label')).toBe('退出全屏')

    toggleFullscreenEl.click()

    expect(appShellEl.classList.contains('fullscreen')).toBe(false)
    expect(toggleFullscreenEl.getAttribute('aria-pressed')).toBe('false')
    expect(toggleFullscreenEl.getAttribute('aria-label')).toBe('全屏窗口')
  })

  it('leaves fullscreen mode when minimized', () => {
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')

    const controls = createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    })

    controls.registerFloatingWindowControls()
    toggleFullscreenEl.click()
    controls.setWindowMinimized(true)

    expect(appShellEl.classList.contains('fullscreen')).toBe(false)
    expect(appShellEl.classList.contains('minimized')).toBe(true)
    expect(toggleFullscreenEl.getAttribute('aria-pressed')).toBe('false')
  })

  it('restores the single-layer workspace after coming back from the launcher', () => {
    const appShellEl = document.createElement('main')
    appShellEl.classList.add('fullscreen')
    const closeWindowEl = document.createElement('button')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')

    const controls = createFloatingWindowControls({
      appShellEl,
      closeWindowEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    })
    controls.registerFloatingWindowControls()

    closeWindowEl.click()

    expect(appShellEl.classList.contains('minimized')).toBe(true)
    expect(appShellEl.classList.contains('fullscreen')).toBe(false)

    windowLauncherEl.click()

    expect(appShellEl.classList.contains('minimized')).toBe(false)
    expect(appShellEl.classList.contains('fullscreen')).toBe(true)
    expect(toggleFullscreenEl.getAttribute('aria-pressed')).toBe('true')
  })

  it('minimizes the whole floating shell from the top-right close affordance', () => {
    const appShellEl = document.createElement('main')
    const closeWindowEl = document.createElement('button')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')

    createFloatingWindowControls({
      appShellEl,
      closeWindowEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    closeWindowEl.click()

    expect(appShellEl.classList.contains('minimized')).toBe(true)
    expect(windowLauncherEl.hidden).toBe(false)
    expect(toggleWindowSizeEl.getAttribute('aria-expanded')).toBe('false')
  })

  it('drags the window from the top chrome without a dedicated drag handle', () => {
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')
    const titlebarEl = document.createElement('header')
    appShellEl.append(titlebarEl)
    document.body.append(appShellEl)
    Object.defineProperty(appShellEl, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 80,
        right: 700,
        bottom: 580,
        width: 600,
        height: 500,
        x: 100,
        y: 80,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    appShellEl.setPointerCapture = () => undefined
    appShellEl.releasePointerCapture = () => undefined
    appShellEl.hasPointerCapture = () => true

    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    titlebarEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 180, clientY: 96, pointerId: 1, bubbles: true }))
    appShellEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 126, pointerId: 1, bubbles: true }))

    expect(appShellEl.style.left).toBe('140px')
    expect(appShellEl.style.top).toBe('110px')
    expect(appShellEl.classList.contains('dragging')).toBe(true)
  })

  it('does not start dragging from toolbar buttons', () => {
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')
    appShellEl.append(toggleWindowSizeEl)
    document.body.append(appShellEl)
    Object.defineProperty(appShellEl, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 80,
        right: 700,
        bottom: 580,
        width: 600,
        height: 500,
        x: 100,
        y: 80,
        toJSON: () => ({}),
      }),
    })

    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
    }).registerFloatingWindowControls()

    toggleWindowSizeEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 120, clientY: 96, pointerId: 1, bubbles: true }))
    appShellEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 220, clientY: 126, pointerId: 1, bubbles: true }))

    expect(appShellEl.style.left).toBe('')
    expect(appShellEl.style.top).toBe('')
    expect(appShellEl.classList.contains('dragging')).toBe(false)
  })

  it('resizes the floating shell from the resize handle with minimum dimensions', () => {
    const appShellEl = document.createElement('main')
    const toggleWindowSizeEl = document.createElement('button')
    const toggleFullscreenEl = document.createElement('button')
    const windowLauncherEl = document.createElement('button')
    const windowResizeHandleEl = document.createElement('button')
    appShellEl.append(windowResizeHandleEl)
    document.body.append(appShellEl)
    Object.defineProperty(appShellEl, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 80,
        right: 1000,
        bottom: 700,
        width: 900,
        height: 620,
        x: 100,
        y: 80,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })
    windowResizeHandleEl.setPointerCapture = () => undefined
    windowResizeHandleEl.releasePointerCapture = () => undefined
    windowResizeHandleEl.hasPointerCapture = () => true

    createFloatingWindowControls({
      appShellEl,
      toggleWindowSizeEl,
      toggleFullscreenEl,
      windowLauncherEl,
      windowResizeHandleEl,
    }).registerFloatingWindowControls()

    windowResizeHandleEl.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 1000, clientY: 700, pointerId: 1, bubbles: true }))
    windowResizeHandleEl.dispatchEvent(new PointerEvent('pointermove', { clientX: 500, clientY: 320, pointerId: 1, bubbles: true }))

    expect(appShellEl.style.width).toBe('760px')
    expect(appShellEl.style.height).toBe('520px')
    expect(appShellEl.classList.contains('resizing')).toBe(true)
  })
})
