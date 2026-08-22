# Source adapter implementation guide

Choose the least expensive public transport that exposes trustworthy job facts:

1. Public JSON response (`json`).
2. Structured JSON embedded in a public page (`embedded_json`).
3. Static public HTML (`html`).
4. Browser-rendered public page (`browser`) only when the first three cannot expose the data.

An adapter declares this choice in `metadata.capabilities.transport`. JSON and HTML adapters use
`SourceHttpClient`; browser adapters use the optional `SourcePageClient`, which returns a neutral HTML
snapshot or same-session structured page collection and does not expose browser-library objects to the contract. All variants use the same
`discover` → optional `fetchDetail` → `normalize` → `healthCheck` lifecycle.

Adapters must call `assertPublicCollectionStrategy` during configuration/research validation. A source
that requires login state, session cookies, CAPTCHA handling, or challenge bypass is reported as
`access_blocked`; it is not silently upgraded to browser automation.

The executable structured-data example and reusable contract suite are in
`test/source-core.test.ts`. Company adapters should use the same event order, completion evidence,
canonical URL policy, stable external identity, cancellation checks, and fixture safety scan.
