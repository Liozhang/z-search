/**
 * Design tokens — JS mirror of CSS variables in leadero-tokens.css.
 *
 * Use these constants for inline props (icon size, etc.) where CSS variables
 * cannot be applied directly. For CSS properties, prefer the CSS tokens.
 */

/** Icon sizes — mirrors CSS --icon-* tokens */
export const ICON = {
  xs: 10, // --icon-xs: status indicators, inline close
  sm: 12, // --icon-sm: toolbar, tool calls, search
  base: 14, // --icon-base: buttons, cards, homepage
  md: 16, // --icon-md: live progress steps, inline timeline
  lg: 18, // --icon-lg: header, main actions
  xl: 24, // --icon-xl: drop zones
  compact: 10, // compact inline icons, e.g. collapsible chevrons
} as const;
