# Verification records

Verification now uses the [tracked-spec index](../specs/README.md).

- [001 — Historical verification migration](../specs/archive/001-historical-verification-migration.md)
  records evidence preservation only.
- [Original revision 7 report (1296 lines, unaltered)](../specs/archive/evidence/verification-revision-7.md)
  retains every historical observation and limitation. SHA-256:
  `33434bd14decd5dbfa1cffa8fc0069e25b6ec2ff824b3ab6f2ef45bc6ce7790f`.
- [002 — Loader fixes and spec migration](../specs/archive/002-loader-fixes-and-spec-migration.md)
  records completed local acceptance, fixture-based WebGL checks and explicit
  remaining limitations. Loader fixes landed in `997ae42`.

The old report's PASS verdicts apply only to the revisions/environment it names;
they are not proof of the current checkout. Its section 8 explicitly leaves real
browser/Mol*/WebGL rendering, marker display, live session and tool-to-mounted-viewer
delivery, host gzip file-open plumbing, preferences and performance checks unverified.
Migration did not perform or complete these checks. Spec 002 records fresh scoped
acceptance and remaining gaps separately rather than rewriting historical evidence.
