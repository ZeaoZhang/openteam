import { afterEach, describe, expect, it, vi } from 'vitest'

type RuntimeMessage = { type?: string; [key: string]: unknown }
type RuntimeListener = (
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean

async function setupBackgroundWithRouteHandler(handler: (message: RuntimeMessage) => unknown | Promise<unknown>) {
  vi.resetModules()
  vi.doMock('./messageRouter', () => ({
    createMessageRouter: () => handler,
  }))
  const controlClient = {
    sync: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
  }
  vi.doMock('./controlClient', () => ({
    createControlClient: vi.fn(() => controlClient),
  }))

  const runtimeListeners: RuntimeListener[] = []
  const alarmListeners: Array<(alarm: chrome.alarms.Alarm) => void | Promise<void>> = []

  vi.stubGlobal('chrome', {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      onMessage: { addListener: vi.fn(listener => runtimeListeners.push(listener)) },
      onMessageExternal: { addListener: vi.fn() },
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      getURL: vi.fn((path: string) => `chrome-extension://test/${path}`),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
        remove: vi.fn(async () => undefined),
      },
    },
    tabs: {
      sendMessage: vi.fn().mockResolvedValue({ ok: true }),
      create: vi.fn().mockResolvedValue({}),
      onRemoved: { addListener: vi.fn() },
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn(listener => alarmListeners.push(listener)) },
    },
    action: {
      onClicked: { addListener: vi.fn() },
    },
  })

  await import('./index')

  return { alarmListeners, controlClient, runtimeListeners }
}

function invokeRuntimeListener(listener: RuntimeListener, message: RuntimeMessage): Promise<unknown> {
  return new Promise(resolve => {
    const keepAlive = listener(message, { tab: { id: 900 } as chrome.tabs.Tab, frameId: 0 }, resolve)
    expect(keepAlive).toBe(true)
  })
}

describe('background entrypoint', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.doUnmock('./messageRouter')
    vi.doUnmock('./controlClient')
  })

  it('converts synchronous message handler failures into safe responses without console output', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const harness = await setupBackgroundWithRouteHandler(() => {
      throw new Error('sync route failure')
    })
    expect(harness.runtimeListeners).toHaveLength(1)

    await expect(invokeRuntimeListener(harness.runtimeListeners[0], { type: 'BROKEN_MESSAGE' })).resolves.toEqual({
      ok: false,
      error: 'sync route failure',
    })
    expect(consoleError).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  it('uses an alarm to periodically wake and sync the local control client', async () => {
    const harness = await setupBackgroundWithRouteHandler(async () => ({ ok: true }))
    const chromeMock = chrome as unknown as {
      alarms: {
        create: ReturnType<typeof vi.fn>
      }
    }

    expect(chromeMock.alarms.create).toHaveBeenCalledWith('openteam-control-keepalive', { periodInMinutes: 0.4 })
    expect(harness.controlClient.sync).toHaveBeenCalledTimes(1)
    expect(harness.alarmListeners).toHaveLength(1)

    await harness.alarmListeners[0]({ name: 'openteam-control-keepalive' } as chrome.alarms.Alarm)

    expect(harness.controlClient.sync).toHaveBeenCalledTimes(2)
  })
})
