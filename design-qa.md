# Resume Studio Design QA

- Source: `/var/folders/mf/l52yxkf12jx0ycrpdm83k7b40000gn/T/codex-clipboard-e11846dc-e5de-4022-b3b0-4b1650f5bf21.png`
- Desktop implementation: `var/resume-studio-toolbar-canvas-aligned.png`
- Center-line evidence: `var/resume-studio-toolbar-center-guide.png`
- Narrow implementation: `var/resume-studio-toolbar-canvas-aligned-mobile.png`
- Focused comparison: `var/resume-role-comparison.png`
- Viewports: 1440 × 900 and 390 × 844 CSS px
- Capture density: 1×
- State: “基本信息” selected; candidate name changed directly in the canvas to “Alex Chen”; professional skills contain two complete sentences.

## Comparison

- Toolbar: desktop uses a four-column grid that mirrors the 10rem chapter rail before centering the typography controls in the remaining canvas region. The controls and A4 paper share the same x=800 center line at the 1440 px viewport; the selection hint and structural actions do not affect that axis.
- Header hierarchy: the target role sits immediately to the right of the name on the same flex row. Its size is approximately half of the name size and uses the reference's muted blue-gray, heavy-weight treatment.
- Skills: professional skills render as a semantic unordered list with coral markers and the same tinted detail block treatment used by experience content.
- Responsive behavior: below 560 px the toolbar and chapter navigation become horizontal scrollers while the A4 canvas scales to the available width without full-page horizontal overflow.

## Verification history

1. Opened the seeded profile and entered `/resume-studio/[draftId]` through the real template export entry.
2. Verified the editable iframe exposes two professional-skill list items containing complete sentences.
3. Directly edited the candidate name in the canvas, blurred the field, and observed the persisted draft revision increment.
4. Compared the supplied name/role/contact reference and the implementation in one normalized image; the comparison preserves each crop's aspect ratio and scales both into equal-height review bands.
5. Captured desktop and 390 px layouts after the final toolbar grid correction. The annotated center-line capture crosses both the tool group midpoint and the A4 paper midpoint.

## Automated evidence

- Premium strict audit: 0 errors, 0 warnings, 0 unresolved findings.
- Formatter, ESLint, TypeScript, production Web build, repository documentation check, and relevant package tests passed.
- `designmd lint DESIGN.md`: 0 errors; 24 pre-existing orphan-token warnings caused by component-reference coverage in the design document.

## Final result

passed
