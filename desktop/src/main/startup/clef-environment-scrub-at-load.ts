import { scrubClefEnvironment } from '../clef/clef-env-scrub'

// Why at load: src/main/index.ts imports this first, so the Clef variables are gone before any
// other module can read process.env or start a child that inherits it (D-012).
const removedClefVariables = scrubClefEnvironment(process.env)
if (removedClefVariables.length > 0) {
  console.warn(
    `[clef] Ignored and removed credential environment variables (save them in Settings instead): ${removedClefVariables.join(', ')}`
  )
}
