# Design-review tooling

Product UI follows [STYLEGUIDE.md](../../desktop/docs/STYLEGUIDE.md) and [DESIGN.md](../../DESIGN.md).

The scripts in [scripts/design](../../scripts/design) include offline policy checks and optional critic orchestration. They are not a production NASH task loop or a release approval service.

[review-policy.json](review-policy.json) and [review-prompt.md](review-prompt.md) are executable tooling inputs and are retained unchanged. The old preparation and capability-preflight reports were removed because they described a historical environment.

Offline fixtures do not establish live model isolation, visual quality or release readiness. Review results do not replace functional tests. No live critic or asset-generation run was performed as part of the current release.

Run the existing offline checks from the repository root:

```text
node --test scripts/design/review-gate.test.mjs
```
