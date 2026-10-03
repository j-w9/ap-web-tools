import { Download } from 'lucide-react'
import { Section, downloadBytes } from '@apwt/tool-shell'
import type { EmbeddedFile } from '../analysis/files.js'
import { Badge, Table, bytes } from './common.js'

/** Files embedded in the log, as downloads. */
export function FilesSection({ files }: { files: readonly EmbeddedFile[] }) {
  if (files.length === 0) return null
  return (
    <Section title="Embedded files" help="Files the flight controller wrote into the log.">
      <Table head={['File', 'Size', '']} right={[1, 2]}>
        {files.map((f) => (
          <tr key={f.name}>
            <td>
              {f.name} {f.isCrashDump && <Badge tone="bad">crash dump</Badge>}
            </td>
            <td>{bytes(f.data.length)}</td>
            <td>
              <button
                type="button"
                className="apwt-btn"
                onClick={() => downloadBytes(f.name, f.data)}
                title={`Download ${f.name}`}
              >
                <Download />
                Download
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </Section>
  )
}
