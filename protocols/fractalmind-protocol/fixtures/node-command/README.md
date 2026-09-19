# NodeCommand v1 golden fixture

`v1-golden.json` is the protocol-owned canonical cross-repository fixture for
`fractalmind.node-command.v1`.

- Initial source: `fractalmind-envd/internal/nodecommand/testdata/v1-golden.json`
- Source lineage: envd PR #69, merged as `d5369b572a412d77b1ee6ade6e254db1fbcbd0cb`
- SHA-256: `f4fb11b9194abbafad3bd1a674c0dc4895f14b726f2f24d8862feeb95c9e8a44`

The protocol SDK consumes this file directly. Envd and other repositories may
mirror it, but their tests must pin the same content hash so serialization drift
fails before release.
