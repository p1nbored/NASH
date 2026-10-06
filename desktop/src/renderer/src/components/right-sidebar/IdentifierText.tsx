import { Fragment } from 'react'

const SEPARATOR_RUN = /([/\\:]+)/

// Why <wbr>: identifiers wrap at path separators instead of mid-segment, and copied text stays exact.
export default function IdentifierText({ value }: { value: string }): React.JSX.Element {
  const parts = value.split(SEPARATOR_RUN)
  let offset = 0
  return (
    <>
      {parts.map((part) => {
        const key = offset
        offset += part.length
        if (!SEPARATOR_RUN.test(part)) {
          return <Fragment key={key}>{part}</Fragment>
        }
        return (
          <Fragment key={key}>
            {part}
            <wbr />
          </Fragment>
        )
      })}
    </>
  )
}
