import type { ComponentPropsWithoutRef } from "react"

/**
 * Custom <a> renderer for ReactMarkdown.
 * Forces all links to open in a new tab, preventing AI-generated markdown
 * links (relative paths, auto-links) from triggering client-side navigation.
 */
export function MarkdownLink(props: ComponentPropsWithoutRef<"a">) {
  return <a {...props} target="_blank" rel="noopener noreferrer" />
}
