# Domain Docs

AMZ.API is a single-context repository.

## Before exploring

Read these when they exist:

- `CONTEXT.md` at the repository root.
- Relevant ADRs under `docs/adr/`.

If they do not exist, proceed silently. The domain-modeling workflow creates them lazily when terminology or an architectural decision is resolved.

## Layout

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

## Vocabulary

Use the canonical terms defined in `CONTEXT.md`. Avoid synonyms that the glossary explicitly rejects.

If a necessary domain concept is missing, reconsider whether it is truly project-specific before adding it.

## ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding the decision.
