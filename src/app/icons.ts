// ---------------------------------------------------------------------------
// Icons — inline SVG inner markup. Paths reused verbatim from the M0 index.html
// for the icons that existed there; the rest are simple stroke-based drawings.
//
// Kept in its own module (no menu imports) so a future embeddable toolbar can
// reuse the exact same icon markup without pulling in the whole app menu.
// ---------------------------------------------------------------------------

/** Builds a stroke-based 16×16 inline-SVG element whose children are `inner`. */
export function svgEl(inner: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.innerHTML = inner
  return svg
}

export const ICON = {
  chevron: `<path d="M4 6l4 4 4-4" />`,
  submenuArrow: `<path d="M6 3.5l4 4.5-4 4.5" />`,
  new: `<rect x="3" y="3" width="10" height="13" rx="1.5" /><path d="M8 6v6.5M4.8 9.2h6.4" />`,
  open: `<path d="M14 12.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5V4a1.5 1.5 0 0 1 1.5-1.5H7l1.5 2h4A1.5 1.5 0 0 1 14 6v6.5z" />`,
  openRecent: `<circle cx="8" cy="8" r="5.8" /><path d="M8 4.8V8l2.2 1.4" />`,
  save: `<rect x="3" y="3" width="10" height="10" rx="1" /><path d="M5.5 3v3.5h5V3" /><path d="M5.5 13v-3h5v3" />`,
  saveAs: `<rect x="4.5" y="5" width="8" height="8" rx="1" /><path d="M6.5 5v2.5h4V5" /><path d="M8 1.5v3.5M6.2 3.2L8 5l1.8-1.8" />`,
  export: `<path d="M4.5 1.5h4.5l3 3v9a1 1 0 0 1-1 1h-6.5a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1z" /><path d="M8.5 7.5v4M6.8 9.8l1.7 1.7 1.7-1.7" />`,
  import: `<path d="M4.5 14.5h4.5l3-3v-9a1 1 0 0 0-1-1H4.5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1z" /><path d="M8.5 8.5v-4M6.8 6.2l1.7-1.7 1.7 1.7" />`,
  help: `<circle cx="8" cy="8" r="5.8" /><path d="M6.2 6.2c0-1 0.8-1.7 1.8-1.7 1 0 1.8 0.7 1.8 1.6 0 1.2-1.8 1.4-1.8 2.6" /><path d="M8 11.5h.01" />`,
  about: `<circle cx="8" cy="8" r="5.8" /><path d="M8 7.2v3.3" /><path d="M8 4.8h.01" />`,
  settings: `<path d="M2.5 4.5h6M2.5 8h3.5M2.5 11.5h7" /><circle cx="11.5" cy="4.5" r="1.7" fill="currentColor" stroke="none" /><circle cx="9" cy="8" r="1.7" fill="currentColor" stroke="none" /><circle cx="12.5" cy="11.5" r="1.7" fill="currentColor" stroke="none" />`,
  undo: `<path d="M4 7H11a3.5 3.5 0 0 1 0 7H9" /><polyline points="6.5 4.5 4 7 6.5 9.5" />`,
  redo: `<path d="M12 7H5a3.5 3.5 0 0 0 0 7h2" /><polyline points="9.5 4.5 12 7 9.5 9.5" />`,
  copy: `<rect x="5.5" y="5.5" width="8" height="8" rx="1" /><path d="M10.5 5.5V4a1.5 1.5 0 0 0-1.5-1.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" />`,
  cut: `<circle cx="4" cy="4" r="2.2" /><circle cx="4" cy="12" r="2.2" /><path d="M13.5 3L5.5 10.8M9.5 9.8l4 3.7M5.5 5.2L8 7.7" />`,
  paste: `<rect x="6.75" y="1.5" width="2.5" height="2" rx="0.75" /><path d="M10.75 3.5h1A1.5 1.5 0 0 1 13.25 5v8.5a1.5 1.5 0 0 1-1.5 1.5h-8a1.5 1.5 0 0 1-1.5-1.5V5a1.5 1.5 0 0 1 1.5-1.5h1" />`,
  bold: `<path d="M4 2.7h5.3a2.7 2.7 0 0 1 0 5.3H4z" /><path d="M4 8h6a2.7 2.7 0 0 1 0 5.3H4z" />`,
  italic: `<path d="M12.5 2.5H6.7M10.6 13.5H3.3M11 2.5L6 13.5" />`,
  underline: `<path d="M4.5 2.5v4.75a3.5 3.5 0 0 0 7 0V2.5" /><path d="M3 13.5h10" />`,
  strikethrough: `<path d="M11.5 2.5H6.5a2.2 2.2 0 0 0-2.1 2.9M10 8a2.9 2.9 0 0 1 0 5.5H4.5" /><path d="M2.5 8h11" />`,
  list: `<path d="M7.5 3.5h6M7.5 8h6M7.5 12.5h6" /><circle cx="3.8" cy="3.5" r="1" fill="currentColor" stroke="none" /><circle cx="3.8" cy="8" r="1" fill="currentColor" stroke="none" /><circle cx="3.8" cy="12.5" r="1" fill="currentColor" stroke="none" />`,
  // --- M3-drawn extras (simple stroke-based, recognizable) ---
  blockquote: `<path d="M5.5 5.2c-1.5.5-2.4 1.6-2.4 3.1 0 .8.4 1.5 1.2 1.9M11 5.2c-1.5.5-2.4 1.6-2.4 3.1 0 .8.4 1.5 1.2 1.9" />`,
  inlineCode: `<path d="M6.2 4L3.2 8l3 4M9.8 4l3 4-3 4" />`,
  codeBlock: `<path d="M5.5 3.5L3 8l2.5 4.5M10.5 3.5L13 8l-2.5 4.5" />`,
  link: `<path d="M8.5 7.5l-1 1a2.4 2.4 0 0 0 3.4 3.4l1.5-1.5a2.4 2.4 0 0 0-3.4-3.4M7.5 8.5l1-1a2.4 2.4 0 0 0-3.4-3.4L3.6 5.6a2.4 2.4 0 0 0 3.4 3.4" />`,
  image: `<rect x="2.5" y="3.5" width="11" height="9" rx="1.5" /><circle cx="6" cy="7" r="0.9" /><path d="M2.8 12l3.2-2.8 2.1 2L10.5 8.8l2.7 2.9" />`,
  table: `<rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M2.5 6.5h11M6 3v10" />`,
  hr: `<path d="M2.5 8h11" />`,
  footnote: `<rect x="5.5" y="2.5" width="4" height="4.2" rx="0.9" /><path d="M2.5 12.5h11" />`,
  taskList: `<rect x="3" y="3" width="10" height="10" rx="1.5" /><path d="M5.5 8l2 2 3.5-3.5" />`,
  emoji: `<circle cx="8" cy="8" r="5.8" /><path d="M5.6 9.3a2.7 2.7 0 0 0 4.8 0" /><path d="M6 6.2h.01M10 6.2h.01" />`,
  headingId: `<path d="M6.3 2.5l-1.6 11M11.3 2.5L9.7 13.5M3.5 6h9.8M3 10.5h9.8" />`,
  defList: `<path d="M2.5 4.5h4.5M2.5 8.5h11M2.5 12.5h7" /><circle cx="12.4" cy="12.2" r="0.45" fill="currentColor" stroke="none" /><circle cx="12.4" cy="13.8" r="0.45" fill="currentColor" stroke="none" />`,
  sub: `<path d="M3 3.5L6.5 7M6.5 3.5L3 7" /><path d="M9.5 9.5h3.2" /><path d="M11 11.2V13.7" /><path d="M9.5 13.4c.2-.7.7-1 1.3-1 .6 0 1 .3 1 .8 0 .4-.4.7-1 .7-.5 0-.9-.2-1.1-.6" />`,
  sup: `<path d="M3 4L6.5 7.5M6.5 4L3 7.5" /><path d="M9.5 3.5h3.2" /><path d="M11 5.2v2.5" /><path d="M9.5 7.4c.2-.7.7-1 1.3-1 .6 0 1 .3 1 .8 0 .4-.4.7-1 .7-.5 0-.9-.2-1.1-.6" />`,
  highlight: `<path d="M5 12l3.5 3.5L11 13 7.5 9.5 5 12z" /><path d="M9.5 7.5L13 11l-2 2-3.5-3.5 2-2z" /><path d="M12.5 4.5l1-1 1 1-1 1z" />`,
  spoiler: `<path d="M3 8s2.5-4 5-4 5 4 5 4-2.5 4-5 4-5-4-5-4z" /><circle cx="8" cy="8" r="1.5" />`,
  dropdown: `<path d="M3 4h10M3 8h10M3 12h10" /><path d="M11 2l2 2-2 2" />`,
  graph: `<path d="M2.5 13.5h11" /><path d="M5 13V9M8 13V5.5M11 13V7.5" />`,
  navigator: `<rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M6 3v10M8.5 6.5h3M8.5 9.5h3" />`,
} as const

/** Names of every icon key in {@link ICON}. */
export type IconName = keyof typeof ICON
