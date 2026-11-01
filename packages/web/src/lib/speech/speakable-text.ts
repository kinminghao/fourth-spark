import type { MessagePart } from "../api-client"
import { classifyPart, getPartText } from "../message-parts"

const FENCE = /^\s*(`{3,}|~{3,})/
const HEADING = /^\s{0,3}#{1,6}\s*/
const BLOCKQUOTE = /^\s*(?:>\s?)+/
const LIST_MARKER = /^\s*(?:[-*+]|\d+\.)\s+/
const HORIZONTAL_RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const TABLE_SEPARATOR = /^\s*[-:|\s]+$/

function stripFencedCode(markdown: string): string {
  const kept: string[] = []
  let fence: string | null = null

  for (const line of markdown.split("\n")) {
    const match = FENCE.exec(line)
    if (fence === null) {
      if (match) {
        fence = match[1][0]
        continue
      }
      kept.push(line)
      continue
    }
    if (match && match[1][0] === fence) {
      fence = null
    }
  }

  return kept.join("\n")
}

function stripTables(lines: readonly string[]): string[] {
  const kept: string[] = []
  let inTable = false

  for (const line of lines) {
    const isSeparator = line.includes("|") && line.includes("-") && TABLE_SEPARATOR.test(line)
    if (isSeparator) {
      if (kept.length > 0 && kept[kept.length - 1].includes("|")) {
        kept.pop()
      }
      inTable = true
      continue
    }
    if (inTable) {
      if (line.trim() === "") {
        inTable = false
        kept.push(line)
      }
      continue
    }
    if (/^\s*\|/.test(line)) {
      continue
    }
    kept.push(line)
  }

  return kept
}

function stripInlineMarkers(line: string): string {
  let text = line.replace(BLOCKQUOTE, "")
  text = text.replace(HEADING, "")
  text = text.replace(LIST_MARKER, "")
  text = text.replace(/~~/g, "")
  text = text.replace(/\*\*/g, "")
  text = text.replace(/__/g, "")
  text = text.replace(/\*/g, "")
  text = text.replace(/_/g, "")
  return text
}

export function toSpeakableText(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, "\n")
  text = stripFencedCode(text)
  text = text.replace(/`[^`]*`/g, " ")
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
  text = text.replace(/<[^>]*>/g, " ")

  const lines: string[] = []
  for (const line of stripTables(text.split("\n"))) {
    if (HORIZONTAL_RULE.test(line)) {
      continue
    }
    const cleaned = stripInlineMarkers(line)
      .replace(/[ \t]+/g, " ")
      .trim()
    lines.push(cleaned)
  }

  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const SENTENCE_TERMINATORS = new Set(["。", "！", "？", "!", "?", "；", ";"])

export function splitSpeechChunks(text: string, maxChars = 200): string[] {
  const limit = Math.max(1, Math.floor(maxChars))
  const segments: string[] = []
  let buffer = ""

  const flush = (): void => {
    const segment = buffer.trim()
    if (segment.length > 0) {
      segments.push(segment)
    }
    buffer = ""
  }

  for (const char of text) {
    if (char === "\n" || char === "\r") {
      flush()
      continue
    }
    buffer += char
    if (SENTENCE_TERMINATORS.has(char)) {
      flush()
    }
  }
  flush()

  const chunks: string[] = []
  for (const segment of segments) {
    let remainder = segment
    while (remainder.length > limit) {
      const window = remainder.slice(0, limit)
      const lastSpace = window.lastIndexOf(" ")
      const cut = lastSpace > 0 ? lastSpace : limit
      const head = remainder.slice(0, cut).trim()
      if (head.length > 0) {
        chunks.push(head)
      }
      remainder = remainder.slice(cut).trim()
    }
    if (remainder.length > 0) {
      chunks.push(remainder)
    }
  }

  return chunks
}

export function extractSpeakableMessageText(parts: readonly MessagePart[]): string {
  const text = parts
    .filter((part) => classifyPart(part) === "text")
    .map((part) => getPartText(part))
    .join("\n\n")
  return toSpeakableText(text)
}
