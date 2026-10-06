// PTY child for the terminal acceptance tests: plain node, never a shell.
// Why hex: ConPTY re-renders output, so input evidence is reported as ASCII hex.
const ESC = '\x1b'
const out = (line) => process.stdout.write(`${line}\r\n`)
const hex = (data) => Buffer.from(data).toString('hex')

let lines = 0
let sigints = 0
let raw = false

process.on('SIGINT', () => {
  sigints += 1
  out(`SIGINT ${sigints}`)
})
// Why: libuv only raises SIGWINCH under ConPTY while stdin is read in raw mode.
process.stdout.on('resize', () => out(`RESIZE ${process.stdout.columns}x${process.stdout.rows}`))

const commands = {
  raw: () => {
    process.stdin.setRawMode(true)
    raw = true
    out('RAW-ON')
  },
  'paste-on': () => {
    process.stdout.write(`${ESC}[?2004h`)
    out('PASTE-ON')
  },
  'alt-on': () => process.stdout.write(`${ESC}[?1049h${ESC}[2J${ESC}[HALT-SCREEN-FRAME\r\n`),
  'alt-off': () => {
    process.stdout.write(`${ESC}[?1049l`)
    out('ALT-OFF')
  },
  show: (arg) => out(`SHOW ${Buffer.from(arg, 'hex').toString('utf8')}`),
  ticks: (arg) => {
    const [count, delayMs] = arg.split(' ').map(Number)
    setTimeout(() => {
      for (let tick = 1; tick <= count; tick += 1) {
        out(`TICK ${tick}`)
      }
    }, delayMs)
  },
  exit: (arg) => process.exit(Number(arg))
}

process.stdin.on('data', (chunk) => {
  if (raw) {
    out(`RAW ${hex(chunk)}`)
    if (chunk.includes(0x04)) {
      process.stdin.setRawMode(false)
      raw = false
      out('RAW-OFF')
    }
    return
  }
  for (const line of chunk.toString('utf8').split(/\r?\n/)) {
    if (line.length === 0) {
      continue
    }
    lines += 1
    out(`LINE ${lines} ${hex(line)}`)
    const [verb, ...rest] = line.split(' ')
    commands[verb]?.(rest.join(' '))
  }
})

out(`READY ${process.stdout.columns}x${process.stdout.rows}`)
