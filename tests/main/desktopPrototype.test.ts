import { describe, expect, it, vi } from 'vitest'
import { DesktopPrototype } from '../../electron/main/desktop/prototype'
const nonce = '12345678-1234-1234-1234-123456789abc'
function setup() {
  const target = { open: vi.fn().mockResolvedValue(undefined), focused: vi.fn().mockReturnValue(true), read: vi.fn().mockResolvedValue(`Roster test ${nonce}`), capture: vi.fn().mockResolvedValue('data:image/png;base64,abc'), close: vi.fn() }
  const type = vi.fn().mockResolvedValue(undefined)
  return { target, type, prototype: new DesktopPrototype(() => target, type, () => nonce) }
}
describe('desktop prototype', () => {
  it('verifies real readback before capturing evidence and always closes the window', async () => {
    const { prototype, target, type } = setup()
    expect(await prototype.run()).toEqual({ expected: `Roster test ${nonce}`, observed: `Roster test ${nonce}`, screenshot: 'data:image/png;base64,abc' })
    expect(type).toHaveBeenCalledWith(nonce)
    expect(target.close).toHaveBeenCalledOnce()
  })
  it('does not type when the target loses focus', async () => {
    const { prototype, target, type } = setup()
    target.focused.mockReturnValue(false)
    await expect(prototype.run()).rejects.toThrow('focus')
    expect(type).not.toHaveBeenCalled()
    expect(target.close).toHaveBeenCalledOnce()
  })
  it('rejects mismatched readback instead of claiming success', async () => {
    const { prototype, target } = setup()
    target.read.mockResolvedValue('')
    await expect(prototype.run()).rejects.toThrow('did not match')
    expect(target.capture).not.toHaveBeenCalled()
    expect(target.close).toHaveBeenCalledOnce()
  })
  it('cleans up on helper failure and allows retry', async () => {
    const { prototype, type, target } = setup()
    type.mockRejectedValueOnce(new Error('Accessibility access required'))
    await expect(prototype.run()).rejects.toThrow('Accessibility')
    await expect(prototype.run()).resolves.toBeDefined()
    expect(target.close).toHaveBeenCalledTimes(2)
  })
  it('rejects concurrent tests', async () => {
    const { prototype, target } = setup()
    let release!: () => void
    target.open.mockReturnValueOnce(new Promise<void>(resolve => { release = resolve }))
    const first = prototype.run()
    await expect(prototype.run()).rejects.toThrow('already running')
    release()
    await first
  })
})
