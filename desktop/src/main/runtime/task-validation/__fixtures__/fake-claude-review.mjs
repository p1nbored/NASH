// FIXTURE_ONLY claude -p stand-in: reads ../fake-claude-scenario.json, writes fake-received.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const scenario = JSON.parse(
  readFileSync(join(dirname(process.cwd()), 'fake-claude-scenario.json'), 'utf8')
)
const chunks = []
process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', () => {
  writeFileSync(
    join(process.cwd(), 'fake-received.json'),
    JSON.stringify({
      argv: process.argv.slice(2),
      stdin: Buffer.concat(chunks).toString('utf8'),
      cwd: process.cwd(),
      envNames: Object.keys(process.env).sort()
    })
  )
  if (scenario.hang) {
    setInterval(() => {}, 1000)
    return
  }
  if (typeof scenario.stdout === 'string') {
    process.stdout.write(scenario.stdout)
  }
  process.exitCode = scenario.exit ?? 0
})
