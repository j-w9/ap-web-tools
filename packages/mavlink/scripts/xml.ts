/**
 * A deliberately small XML parser for the MAVLink message definitions.
 *
 * It handles what those files use (elements, attributes, text, comments, the XML declaration and
 * the five predefined entities plus numeric character references) and rejects anything else
 * loudly, so a definition file using a feature we do not understand fails generation instead of
 * being silently misread. It is not a general-purpose XML parser.
 */

export interface XmlElement {
  readonly name: string
  readonly attributes: ReadonlyMap<string, string>
  readonly children: readonly XmlNode[]
}

export type XmlNode = XmlElement | string

const ENTITIES: Readonly<Record<string, string>> = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' }

/** Replaces entity and character references with the characters they stand for. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (whole, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(parseInt(ref.slice(2), 16))
    if (ref.startsWith('#')) return String.fromCodePoint(parseInt(ref.slice(1), 10))
    const named = ENTITIES[ref]
    if (named === undefined) throw new Error(`Unknown XML entity ${whole}`)
    return named
  })
}

interface MutableElement {
  name: string
  attributes: Map<string, string>
  children: XmlNode[]
}

const NAME = /[A-Za-z_][\w.:-]*/y
const ATTRIBUTE = /\s+([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/y

/** Parses a document and returns its root element. */
export function parseXml(source: string): XmlElement {
  const root: MutableElement = { name: '#document', attributes: new Map(), children: [] }
  const stack: MutableElement[] = [root]
  let position = 0

  const fail = (message: string): never => {
    const line = source.slice(0, position).split('\n').length
    throw new Error(`XML parse error at line ${line}: ${message}`)
  }
  const current = (): MutableElement => stack[stack.length - 1] ?? fail('unbalanced elements')

  while (position < source.length) {
    const open = source.indexOf('<', position)
    const textEnd = open === -1 ? source.length : open
    if (textEnd > position) {
      const text = source.slice(position, textEnd)
      if (stack.length === 1) {
        if (text.trim() !== '') fail('text outside the root element')
      } else {
        current().children.push(decodeEntities(text))
      }
    }
    if (open === -1) break
    position = open

    if (source.startsWith('<!--', position)) {
      const end = source.indexOf('-->', position + 4)
      if (end === -1) fail('unterminated comment')
      position = end + 3
    } else if (source.startsWith('<?', position)) {
      const end = source.indexOf('?>', position + 2)
      if (end === -1) fail('unterminated processing instruction')
      position = end + 2
    } else if (source.startsWith('<!', position)) {
      fail('DOCTYPE and CDATA sections are not supported')
    } else if (source.startsWith('</', position)) {
      NAME.lastIndex = position + 2
      const match = NAME.exec(source) ?? fail('bad closing tag')
      const element = current()
      if (element.name !== match[0]) fail(`</${match[0]}> closes <${element.name}>`)
      stack.pop()
      position = NAME.lastIndex
      while (/\s/.test(source.charAt(position))) position++
      if (source.charAt(position) !== '>') fail('bad closing tag')
      position++
    } else {
      NAME.lastIndex = position + 1
      const match = NAME.exec(source) ?? fail('bad element name')
      const element: MutableElement = { name: match[0], attributes: new Map(), children: [] }
      position = NAME.lastIndex
      for (;;) {
        ATTRIBUTE.lastIndex = position
        const attribute = ATTRIBUTE.exec(source)
        if (attribute === null) break
        const [, key = '', , doubleQuoted, singleQuoted] = attribute
        if (element.attributes.has(key)) fail(`duplicate attribute ${key}`)
        element.attributes.set(key, decodeEntities(doubleQuoted ?? singleQuoted ?? ''))
        position = ATTRIBUTE.lastIndex
      }
      while (/\s/.test(source.charAt(position))) position++
      current().children.push(element)
      if (source.startsWith('/>', position)) {
        position += 2
      } else if (source.charAt(position) === '>') {
        stack.push(element)
        position++
      } else {
        fail(`malformed start tag <${element.name}>`)
      }
    }
  }

  if (stack.length !== 1) fail(`unclosed <${current().name}>`)
  const elements = root.children.filter((child): child is MutableElement => typeof child !== 'string')
  const [documentElement] = elements
  if (elements.length !== 1 || documentElement === undefined) return fail('expected exactly one root element')
  return documentElement
}

/** Child elements of `element`, optionally only those named `name`. */
export function childElements(element: XmlElement, name?: string): XmlElement[] {
  return element.children.filter(
    (child): child is XmlElement => typeof child !== 'string' && (name === undefined || child.name === name)
  )
}

/** The first child element named `name`, if any. */
export function childElement(element: XmlElement, name: string): XmlElement | undefined {
  return childElements(element, name)[0]
}

/** Concatenated text content of an element and its descendants, whitespace collapsed. */
export function textContent(element: XmlElement): string {
  const parts: string[] = []
  const walk = (node: XmlNode): void => {
    if (typeof node === 'string') parts.push(node)
    else node.children.forEach(walk)
  }
  walk(element)
  return parts.join('').replace(/\s+/g, ' ').trim()
}
