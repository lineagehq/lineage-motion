# Lineage Motion

Lineage Motion is an experimental local-first authoring workspace for
synchronized, browser-native product demos and coach-mark walkthroughs.

Its central idea is shared UX for humans and agents: a person editing a master
timeline and an agent using structured commands operate on the same revisioned
motion document, through the same domain operations, with visible branches,
claims, annotations, review, and handoff.

The intended production output is deterministic HTML/CSS. A minimal generated
JavaScript binding is allowed only when browser interaction semantics cannot be
expressed in CSS.

## Status

This repository is in standalone incubation. It is intentionally separate from
[lineagehq/lineage](https://github.com/lineagehq/lineage) while the motion
document, importer, preview, compiler, and shared human/agent workflow are
proven against real synchronized walkthroughs.

There is no published package, stable schema, production runtime, hosted
service, or Lineage database integration yet.

## Product claim

> Import an existing self-contained HTML/CSS product walkthrough, understand
> its complete choreography on one shared timeline, let a human or agent make
> the same precise sequence-wide edits, and export deterministic browser-native
> HTML/CSS without a production runtime.

## Start here

- [Incubation plan](docs/incubation-plan.md)
- [Shared human/agent UX contract](docs/shared-ux-contract.md)
- [Relationship to Lineage](docs/lineage-relationship.md)
- [Architecture boundary](docs/architecture.md)
- [Acceptance-corpus policy](docs/acceptance-corpus.md)
- [Agent execution workflow](docs/agent-workflow.md)

## Current scope

The first evidence slice is deliberately narrow:

1. Inventory one self-contained HTML/CSS coach-mark scene.
2. Import every supported animation application into a canonical document.
3. Show all element/property tracks on one master timeline.
4. Scrub the exact CSS that will be exported.
5. Export deterministic pure HTML/CSS.
6. Prove visual equivalence at stable frames and discrete boundaries.
7. Stop for architecture review before adding persistence or collaboration.

The larger synchronized landing animation is a later stress test, not the
first implementation target.

## License

[MIT](LICENSE)
