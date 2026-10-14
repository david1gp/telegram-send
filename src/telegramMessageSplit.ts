/**
 * Split a message string into segments that each fit within the limit (default 4096).
 * If html mode is enabled, tag tracking ensures opened formatting tags are closed at
 * chunk boundaries and reopened in the following chunk.
 */
function telegramMessageSplit(message: string, limit = 4096, html = false): string[] {
  if (!message) return []
  if (message.length <= limit) return [message]

  const maxLen = Math.max(1, limit)
  if (!html) {
    return plainTextSplit(message, maxLen)
  }
  return htmlTextSplit(message, maxLen)
}

function plainTextSplit(text: string, limit: number): string[] {
  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining)
      break
    }

    const candidate = remaining.slice(0, limit)
    let splitIndex = candidate.lastIndexOf("\n\n")
    if (splitIndex > 0) {
      chunks.push(remaining.slice(0, splitIndex))
      remaining = remaining.slice(splitIndex + 2)
      continue
    }

    splitIndex = candidate.lastIndexOf("\n")
    if (splitIndex > 0) {
      chunks.push(remaining.slice(0, splitIndex))
      remaining = remaining.slice(splitIndex + 1)
      continue
    }

    splitIndex = candidate.lastIndexOf(" ")
    if (splitIndex > 0) {
      chunks.push(remaining.slice(0, splitIndex))
      remaining = remaining.slice(splitIndex + 1)
      continue
    }

    chunks.push(candidate)
    remaining = remaining.slice(limit)
  }

  return chunks
}

function htmlTextSplit(text: string, limit: number): string[] {
  const chunks: string[] = []
  let remaining = text
  let openTags: string[] = []

  const computeTags = (seg: string, initialTags: string[]): string[] => {
    const tagRegex = /<\/?([a-zA-Z0-9]+)(?:\s+[^>]*)?>/g
    let match: RegExpExecArray | null
    const tags = [...initialTags]
    while ((match = tagRegex.exec(seg)) !== null) {
      const fullTag = match[0]!
      const tagName = match[1]!.toLowerCase()
      if (fullTag.startsWith("</")) {
        const idx = tags.lastIndexOf(tagName)
        if (idx !== -1) tags.splice(idx, 1)
      } else if (!fullTag.endsWith("/>")) {
        tags.push(tagName)
      }
    }
    return tags
  }

  while (remaining.length > 0) {
    const prefix = openTags.map((tag) => `<${tag}>`).join("")
    const currentBudget = limit - prefix.length
    if (currentBudget <= 0) {
      return plainTextSplit(text, limit)
    }

    if (prefix.length + remaining.length <= limit) {
      chunks.push(prefix + remaining)
      break
    }

    let cutLength = currentBudget
    let candidate = remaining.slice(0, cutLength)

    const paragraphBreak = candidate.lastIndexOf("\n\n")
    const lineBreak = candidate.lastIndexOf("\n")
    const spaceBreak = candidate.lastIndexOf(" ")

    let splitIndex = -1
    let advance = 0

    if (paragraphBreak > 0) {
      splitIndex = paragraphBreak
      advance = 2
    } else if (lineBreak > 0) {
      splitIndex = lineBreak
      advance = 1
    } else if (spaceBreak > 0) {
      splitIndex = spaceBreak
      advance = 1
    } else {
      splitIndex = cutLength
      advance = 0
    }

    let segment = remaining.slice(0, splitIndex)

    const stripIncompleteEntity = (seg: string): string => {
      const match = /&[a-zA-Z0-9#]*$/.exec(seg)
      if (match) {
        const after = remaining.slice(seg.length - match[0].length)
        if (/^&[a-zA-Z0-9#]+;/.test(after)) {
          const stripped = seg.slice(0, match.index)
          if (stripped.length > 0) return stripped
          // If the entity starts at index 0 and cannot fit in current cut,
          // check if we can include the full entity if budget allows, otherwise let it cut
          const fullMatch = /^&[a-zA-Z0-9#]+;/.exec(after)
          if (fullMatch && fullMatch[0].length <= currentBudget) {
            return fullMatch[0]
          }
        }
      }
      return seg
    }

    segment = stripIncompleteEntity(segment)

    let updatedOpenTags = computeTags(segment, openTags)
    let suffix = updatedOpenTags
      .slice()
      .reverse()
      .map((t) => `</${t}>`)
      .join("")

    while (prefix.length + segment.length + suffix.length > limit && segment.length > 0) {
      segment = segment.slice(0, -1)
      segment = stripIncompleteEntity(segment)
      updatedOpenTags = computeTags(segment, openTags)
      suffix = updatedOpenTags
        .slice()
        .reverse()
        .map((t) => `</${t}>`)
        .join("")
    }

    if (segment.length < splitIndex) {
      advance = 0
    }

    chunks.push(prefix + segment + suffix)
    openTags = updatedOpenTags
    remaining = remaining.slice(segment.length + advance)
  }

  return chunks
}

export { telegramMessageSplit }
