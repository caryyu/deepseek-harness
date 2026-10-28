/** `layout` namespace dictionary: frame chrome copy for the narrow-viewport sidebar toggle. */

/** Stable namespace key consumed by the AppFrame slot registration. */
export const NS = 'layout'

/** Simplified Chinese dictionary. */
export const zh = {
  'toggle.open': '打开侧边栏',
  'toggle.collapse': '收起侧边栏',
} as const

/** English dictionary, checked complete against the zh key set. */
export const en: Record<keyof typeof zh, string> = {
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
}

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh
