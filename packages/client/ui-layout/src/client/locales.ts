/** `layout` namespace dictionaries: frame chrome copy (the narrow-viewport sidebar hide/show toggle). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
} satisfies Record<LayoutKey, string>
