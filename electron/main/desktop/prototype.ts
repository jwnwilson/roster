import { randomUUID } from 'node:crypto'
import type { DesktopTestResult } from '../../../shared/desktop'

export interface DesktopTestWindow {
  open(nonce: string): Promise<void>
  focused(): boolean
  read(): Promise<string>
  capture(): Promise<string>
  close(): void
}

/** A single local test, with no caller-controlled target or text. */
export class DesktopPrototype {
  private running = false
  constructor(
    private readonly create: () => DesktopTestWindow,
    private readonly type: (nonce: string) => Promise<void>,
    private readonly nonce = randomUUID as () => string,
  ) {}

  async run(): Promise<DesktopTestResult> {
    if (this.running) throw new Error('A desktop test is already running.')
    this.running = true
    let target: DesktopTestWindow | undefined
    try {
      const nonce = this.nonce()
      const expected = `Roster test ${nonce}`
      target = this.create()
      await target.open(nonce)
      if (!target.focused()) throw new Error('The test window lost focus. Run the test again and leave it focused.')
      await this.type(nonce)
      const observed = await target.read()
      if (observed !== expected) throw new Error('Desktop test failed: the text read back did not match the test phrase.')
      return { expected, observed, screenshot: await target.capture() }
    } finally {
      target?.close()
      this.running = false
    }
  }
}
