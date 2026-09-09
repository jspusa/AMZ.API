# Explain rejected variation previews using existing public issue metadata

Issue #228 remains open after an actual Preview on the installed, verified 0.1.61 CI package. The original standalone source and target prepare correctly, but the missing Contains Liquid Contents message still has no matching input. The exact upstream code, issue identities and categories have not been observed, so another synthetic scenario alone cannot establish the cause.

The existing main `routeError` already exposes a bounded, sanitized error DTO. The renderer currently discards most of it. Add collapsed check details to the existing error, using only validated public metadata: local response status, application code, operation, upstream code, request ID, and issue code/severity/attribute names/categories/known marketplace IDs. Render text in a table; do not dump JSON, introduce raw responses, log private data, or label the local 422 as the upstream Amazon HTTP status.

This is a renderer-only diagnostic and user-support step, not a new authorization path or a claim that the missing-input bug is solved. Details must clear with the operation/context and never grant fields, create tickets, retry requests, or alter native confirmation/durable claims. Tests cover normal metadata, malformed/private values, context clearing and fresh Preview reset. After checks and independent review, publish Pages and use one intentional fresh Preview to inspect the exact public issue metadata before the next main change.

Preserve concurrent renderer changes through main `e529ffa2f9d189336bee119911b5e5fbb0e68d0e`, the verified 0.1.61 installed package, price comparison/export evidence and all prior release evidence. No formal Amazon mutation is part of acceptance.

The 2026-09-09 production audit newly reports GHSA-2883-xcg3-v3hh in js-yaml 4.3.1, also used transitively by electron-updater. Apply the narrowly scoped 4.3.2 dependency/lockfile patch and rerun checks/audit. This source dependency correction does not retroactively update the installed 0.1.61 CI artifact; this diagnostic delivery publishes Pages and preserves that installation until a separately verified desktop release is needed.
