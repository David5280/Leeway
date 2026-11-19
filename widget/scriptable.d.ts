// The part of Scriptable's API the widget script uses, so TypeScript can
// check the script (https://docs.scriptable.app). Types only; Scriptable
// itself provides these at run time.

interface ScriptableColor {
  readonly hex: string
}

interface ScriptableColorClass {
  new (hex: string, alpha?: number): ScriptableColor
  dynamic(light: ScriptableColor, dark: ScriptableColor): ScriptableColor
}

interface ScriptableFont {
  readonly name?: string
}

interface ScriptableFontClass {
  systemFont(size: number): ScriptableFont
  semiboldSystemFont(size: number): ScriptableFont
  boldRoundedSystemFont(size: number): ScriptableFont
}

interface ScriptableText {
  font: ScriptableFont
  textColor: ScriptableColor
  lineLimit: number
  minimumScaleFactor: number
}

interface ScriptableStack {
  addText(text: string): ScriptableText
  addSpacer(length?: number): unknown
  addStack(): ScriptableStack
  layoutHorizontally(): void
  layoutVertically(): void
}

interface ScriptableWidget extends ScriptableStack {
  backgroundColor: ScriptableColor
  refreshAfterDate: Date
  url: string
  setPadding(top: number, leading: number, bottom: number, trailing: number): void
  presentSmall(): Promise<void>
  presentMedium(): Promise<void>
  presentLarge(): Promise<void>
}

interface ScriptableRequest {
  headers: Record<string, string>
  timeoutInterval: number
  readonly response: { statusCode: number }
  loadString(): Promise<string>
}

interface ScriptableKeychain {
  contains(key: string): boolean
  get(key: string): string
  set(key: string, value: string): void
  remove(key: string): void
}

interface ScriptableAlert {
  title: string
  message: string
  addAction(title: string): void
  addCancelAction(title: string): void
  addSecureTextField(placeholder: string, text: string): void
  textFieldValue(index: number): string
  presentAlert(): Promise<number>
}

declare const args: { widgetParameter: string | null }
declare const config: { runsInWidget: boolean; widgetFamily: string | null }
declare const Keychain: ScriptableKeychain
declare const Request: new (url: string) => ScriptableRequest
declare const ListWidget: new () => ScriptableWidget
declare const Color: ScriptableColorClass
declare const Font: ScriptableFontClass
declare const Alert: new () => ScriptableAlert
declare const Script: { setWidget(widget: ScriptableWidget): void; complete(): void }
