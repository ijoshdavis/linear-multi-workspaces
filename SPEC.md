# Feature Specification: `linear-multi-workspaces` — multi-workspace Linear CLI + skill

**Feature Branch**: `main`

**Created**: 2026-10-17

**Status**: Implemented (v1 built, merged, live-tested against three real workspaces)

**Input**: Give Claude a single, scriptable surface for Linear that (a) isn't tied to the
one claude.ai OAuth workspace, and (b) covers the real workflow: creating issues/projects,
capturing and refining specs inside issues, and periodically cleaning up the backlog.

This is an as-built spec, written in [GitHub spec-kit](https://github.com/github/spec-kit)
format after the fact — it records what was actually shipped, not a pre-build plan. Where
the as-built behavior deviates from what was originally scoped, that's called out inline.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create and refine issues in a workspace the hosted connector can't reach (Priority: P1)

Claude needs to create an issue, assign it, label it, and iteratively refine its
description/comments inside a Linear workspace the hosted claude.ai connector has no
access to (any non-personal workspace: work, client, etc.).

**Why this priority**: This is the whole reason the tool exists — without it, those
workspaces are simply unreachable from Claude.

**Independent Test**: Can be fully tested by running `create-issue`, `update-issue
--append-section`, and `add-comment --quote` against one configured profile and confirming
the issue is visible, correctly assigned/labeled, and the comment is anchored to the quoted
text in the Linear UI.

**Acceptance Scenarios**:

1. **Given** a repo with a `.claude/linear-workspace.json` marker and a valid credential
   for that profile, **When** `create-issue --title "..." --team ENG` is run, **Then** the
   command prints `{"ok": true, "data": {"id", "identifier", "title", "url"}}` and the issue
   exists in that team.
2. **Given** an existing issue identifier, **When** `update-issue --id <ID> --append-section
   "Findings:<path>"` is run, **Then** the issue's description gets a new `## Findings`
   section appended below any existing content, separated by a blank line.
3. **Given** an existing issue, **When** `add-comment --issue <ID> --body-file - --quote
   "<exact text>"` is piped markdown on stdin, **Then** the comment is created anchored to
   that quoted excerpt.

### User Story 2 - Query and audit issues across a workspace (Priority: P2)

Claude needs to list/filter issues by team, state, label, or free-text query to answer
questions or drive cleanup decisions, without hand-rolling GraphQL.

**Why this priority**: Read access is required before any safe write or bulk decision, but
on its own it delivers less value than the create/refine path.

**Independent Test**: Can be fully tested by running `list-issues --team ENG --state
"In Progress"` and confirming the returned count and fields match what's visible in the
Linear UI's filtered view.

**Acceptance Scenarios**:

1. **Given** a team with more than one page of issues, **When** `list-issues --team ENG` is
   run, **Then** all matching issues are returned (pagination is walked transparently), not
   just the first page.
2. **Given** a `--query` string, **When** `list-issues --query "stale onboarding"` is run,
   **Then** results come from Linear's search endpoint scoped to the resolved team, not a
   client-side substring filter.

### User Story 3 - Safely clean up the backlog in bulk (Priority: P3)

Claude needs to retire stale labels, archive dead issues, or bulk-transition issues to a new
state, without risking an unreviewed mass mutation.

**Why this priority**: High blast radius if done wrong, so it's gated behind the dry-run
default and the two higher-value paths above — but it's the recurring maintenance task that
justified building this over a one-off script.

**Independent Test**: Can be fully tested by running `bulk-update --query '{...}'
--set-state Done` without `--apply`, confirming the dry-run output lists exactly the issues
that would change and that none of them actually changed in Linear.

**Acceptance Scenarios**:

1. **Given** any of `bulk-update`, `archive-issue`, or `retire-label`, **When** run without
   `--apply`, **Then** the command makes zero mutating calls and prints `{"dryRun": true,
   ...}` describing exactly what would change.
2. **Given** a prior dry-run has been shown to the user, **When** the same command is
   re-run with `--apply`, **Then** the described mutation is performed and the command
   prints `{"dryRun": false, ...}` with per-item results.
3. **Given** `bulk-update --apply` without `--set-state`, **When** the command runs,
   **Then** it fails with `MISSING_ARG` and makes no mutating calls.

### Edge Cases

- No `--profile` flag and no `.claude/linear-workspace.json` marker → fails `NO_PROFILE`,
  no silent default profile.
- A resolved profile has no entry in `~/.config/linear-cli/credentials.json` → fails
  `NO_CREDENTIAL_FOR_PROFILE`, naming the missing profile.
- The credentials file is readable by group or other → a warning is printed to stderr (not
  stdout) with the `chmod 600` fix, but the command still proceeds.
- A name passed to `--assignee`/`--project`/`--labels`/`--state`/`--team` doesn't match any
  known entity → fails with a `*_NOT_FOUND` error; for teams, the error lists the known team
  keys to recover from.
- Two different tools (this CLI and the hosted connector) can both write to the personal
  workspace — resolved by convention (prefer the hosted connector there), not by the tool
  itself; `whoami` + the issue's activity log is the fallback way to tell which tool touched
  an issue.
- `update-issue` called with neither `--description-file`/`--append-section` nor any other
  field → fails `NO_CHANGES` rather than silently doing nothing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST resolve the active profile from `--profile`, falling back to the
  `profile` key in `.claude/linear-workspace.json`, and MUST fail loudly (`NO_PROFILE`) with
  no silent default when neither is present.
- **FR-002**: System MUST resolve the active team from `--team`, falling back to the `team`
  key in the same marker file; commands that require a team and get none MUST fail
  (`MISSING_TEAM`) rather than guessing.
- **FR-003**: System MUST store credentials outside any git repository, one Personal API Key
  per named profile, and MUST warn (to stderr) when that file is readable by group or other.
- **FR-004**: Every command MUST print exactly one JSON line to stdout: `{"ok": true, "data":
  {...}}` on success or `{"ok": false, "error": {"code", "message"}}` on failure, and MUST
  exit 0 or 1 to match.
- **FR-005**: `bulk-update`, `archive-issue`, and `retire-label` MUST default to a no-op
  dry-run that reports exactly what would change, and MUST only mutate when `--apply` is
  passed.
- **FR-006**: System MUST resolve team/project/label/assignee/state by human-readable name
  (case-insensitively) or by raw ID, via `@linear/sdk` lookups, with each lookup list cached
  per-profile (in-memory and on disk, ~1 hour TTL) to avoid re-listing the workspace on every
  invocation.
- **FR-007**: System MUST accept long text (issue descriptions, comment bodies) via a
  `<path|->` argument, reading from stdin when `-` is given, and MUST NOT require long text
  to be passed as a raw shell argument.
- **FR-008**: `add-comment` MUST support anchoring the comment to an exact quoted excerpt of
  the issue via `--quote`.
- **FR-009**: System MUST walk pagination (`hasNextPage`/cursor) transparently for every
  list/bulk command so callers always get the full result set in one invocation.
- **FR-010**: Each invocation MUST target exactly one Linear workspace; the system MUST NOT
  offer a cross-workspace bulk operation in a single call.
- **FR-011**: `update-issue --append-section` MUST append the new section below any existing
  description content, separated by a blank line if the existing description is non-empty.

### Key Entities

- **Profile**: A named credential + workspace identity (e.g. `work-main`). Maps to exactly
  one Personal API Key in the credential store.
- **Workspace marker**: Per-repo, committed, non-secret file (`.claude/linear-workspace.json`)
  pointing a repo at a default profile/team.
- **Credential store**: Machine-global, never-committed file (`~/.config/linear-cli/credentials.json`)
  mapping profile name → Personal API Key.
- **Issue / Project / Label / WorkflowState / Team**: Linear's own entities, resolved by
  name or ID through `@linear/sdk`; this tool adds no entities of its own on top of Linear's
  data model.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `whoami` correctly resolves profile, workspace, viewer, and team for every
  configured profile with zero misattributed workspace — verified live against all
  configured workspaces during v1 rollout.
- **SC-002**: The full create → assign path (`create-issue` + `add-comment --quote` +
  `update-issue --append-section` + `--state`) succeeds end-to-end in every configured
  workspace — verified via a `CONDUCTOR-TEST` issue created and assigned in each one.
- **SC-003**: `bulk-update`, `archive-issue`, and `retire-label` dry-run output matches
  exactly what changes on the subsequent `--apply` run, with zero mutations before `--apply`
  — verified for all three commands during v1 rollout.
- **SC-004**: A missing or misconfigured profile/credential surfaces as `NO_PROFILE` or
  `NO_CREDENTIAL_FOR_PROFILE` before any network call that could mutate data, 100% of the
  time.

## Assumptions

- Runs on a single Mac with Node.js and npm available; no containerization or multi-host
  deployment is in scope.
- `@linear/sdk` is Linear's official typed client, so entity resolution, mutation shapes,
  and pagination are handled by Linear's own code — this is why Node was chosen for v1 over
  a dependency-free Python port.
- The hosted claude.ai Linear connector remains the preferred path for the user's personal
  workspace; this tool's `personal` profile is a deliberate fallback, not the primary path,
  for that one workspace.
- File/image attachments are out of scope for v1 — specs are text/markdown only.
- Cross-workspace bulk operations are intentionally out of scope, to keep the blast radius
  of `bulk-update` bounded to one workspace per invocation.

## Implementation Notes (as-built, non-normative)

These capture operational detail that spec-kit's template doesn't have a slot for, kept
because losing it would be a regression from the previous version of this document.

**Architecture**: `SKILL.md` instructs Claude to invoke `scripts/linear-cli.mjs <subcommand>
--flag value ...`, built on `@linear/sdk`, which talks to Linear's GraphQL API and always
prints one JSON object to stdout. The only untyped boundary is Claude ↔ script (CLI args in,
JSON out).

**Deployment**: Canonical source is GitHub repo `ijoshdavis/linear-multi-workspaces`, `main`
branch. Globally available via `~/.claude/skills/linear-multi-workspaces`, a symlink to the
non-worktree checkout at `~/_src-conductor/repos/linear-multi-workspaces` (kept on `main`,
`npm install`ed) — the same pattern as the `dt-doctor` and `ship` skills. Updating is
commit/push/merge here, then `git pull` in that checkout; no re-linking needed.

**One deviation from the original draft**: anchored/quoted comments (`add-comment --quote`)
shipped in v1, not deferred — `CommentCreateInput.quotedText` turned out to be a plain field
on Linear's API.

## Open Questions / Future Extensions

- File/image attachments — explicitly deferred (see Assumptions).
- Python port — only worth it if avoiding the npm dependency becomes a real constraint.
- Cross-workspace bulk operations — still out of scope by design.
