# @cdk/contract

The HTTP API and event stream contract from [`docs/architecture.md`](../../docs/architecture.md), as TypeScript types: the resources, the request and response bodies, and the payload of every event kind.

The back end and the front end both import it with `import type { … } from '@cdk/contract'`, so a field renamed here fails typecheck on both sides. It holds types only, so nothing loads it at runtime.
