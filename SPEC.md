# Spec: `linear-multi-workspaces` — a custom skill + CLI for multi-workspace Linear work

Status: **v1 built and merged to `main`**, live-tested against three real workspaces.
This supersedes the original chat draft — it records what was actually built, how it's
deployed, and how to choose between this tool and the hosted connector.

## Goal

Give Claude a single, scriptable surface for Linear that (a) isn't tied to the one
claude.ai OAuth workspace, and (b) covers the real workflow: creating issues/projects,
capturing and refining specs inside issues, and periodically cleaning up the backlog.

## Non-goals (v1)

- File/image attachments (screenshots, diagrams) — specs are text/markdown. Flag as a
  future extension if that changes.
- Cross-workspace bulk operations in a single call — one invocation always targets
  exactly one workspace.
- ~~Replacing the hosted Linear connector for your personal workspace~~ — originally
  scoped out since the hosted connector already covers it. A profile for the personal
  workspace was added anyway during rollout, as a deliberate exception — see
  **Recommended usage** below for how to choose between the two there.

## Architecture (as built)

```
Skill (SKILL.md, at the repo root)
  → instructs Claude to invoke:
scripts/linear-cli.mjs <subcommand> --flag value ...
  → built on @linear/sdk (Linear's official typed JS client)
  → reads workspace/profile config + credentials
  → talks to Linear's GraphQL API
  → always prints one JSON object to stdout
```

Uses `@linear/sdk` internally rather than hand-rolled GraphQL, so entity resolution,
mutation shapes, and pagination are handled by Linear's own typed client. The only
untyped boundary is Claude ↔ script (CLI args in, JSON out).

## Credential & workspace model (as built)

- **Per-repo marker** (committed, non-secret): `.claude/linear-workspace.json`, e.g.
  `{ "profile": "work-main", "team": "ENG" }`. Template at `.claude/linear-workspace.json.example`.
- **Credential store** (never committed, outside any repo): `~/.config/linear-cli/credentials.json`,
  `chmod 600`, one Personal API Key per named profile.
- `--profile` / `--team` flags override the marker per call. Missing profile/credential
  fails loudly (`NO_PROFILE`, `NO_CREDENTIAL_FOR_PROFILE`) — no silent default.
- `linear-cli whoami` resolves and prints profile + workspace + viewer + team; run it
  before the first write in any session touching a workspace.

Example profile table (yours will differ — update this list as profiles change):

| profile | workspace | notes |
|---|---|---|
| `work-main` | a non-personal workspace the hosted connector can't reach | teams `ENG`, `OPS` |
| `personal` | your personal workspace | exception — see Recommended usage |
| `client-a` | another non-personal workspace | team `PROJ` |

## Command surface (as built)

```
linear-cli whoami

linear-cli create-issue --title <str> [--description-file <path|->]
  [--project <name>] [--assignee <email>] [--labels <csv>] [--priority <0-4>] [--state <name>] [--team <key>]

linear-cli update-issue --id <ID>
  [--description-file <path|->] | [--append-section "<heading>:<path|->"]
  [--title <str>] [--assignee <email>] [--labels <csv>] [--state <name>]

linear-cli add-comment --issue <ID> --body-file <path|-> [--quote "<exact text>"]

linear-cli create-project --name <str> [--team <key>] [--description-file <path|->] [--lead <email>]

linear-cli list-issues [--team <key>] [--state <name>] [--label <name>] [--query <str>]

linear-cli bulk-update --query '<filter-json>' --set-state <name> [--team <key>] [--apply]
linear-cli archive-issue --id <ID> [--apply]
linear-cli retire-label --name <str> [--apply]
```

One deviation from the original draft: **anchored/quoted comments shipped in v1**, not
deferred. `CommentCreateInput.quotedText` turned out to be a plain field on Linear's API —
no extra fiddliness — so `add-comment --quote "<exact text>"` just works.

Every command prints exactly one JSON line: `{"ok": true, "data": {...}}` or
`{"ok": false, "error": {"code": ..., "message": ...}}`. `bulk-update`, `archive-issue`,
and `retire-label` default to dry-run and only mutate with `--apply`.

## Deployment (as built)

- **Canonical source**: GitHub repo `ijoshdavis/linear-multi-workspaces`, `main` branch.
- **Local checkout for global use**: the non-worktree checkout at
  `~/_src-conductor/repos/linear-multi-workspaces` (kept on `main`, `npm install`ed).
- **Global availability**: `~/.claude/skills/linear-multi-workspaces` is a symlink to that checkout —
  the same pattern already used for the `dt-doctor` and `ship` skills (source lives in a
  real repo; `~/.claude/skills/<name>` just points at it). This makes the skill visible to
  every Claude Code session on this Mac, including every Conductor workspace, regardless
  of which repo/worktree the session is running in.
- **Updating**: commit/push/merge in this repo as usual, then `git pull` inside
  `~/_src-conductor/repos/linear-multi-workspaces`. No re-linking needed — every session
  picks up the change on its next invocation.
- **Per-repo opt-in**: any repo that should default to a given profile/team gets its own
  `.claude/linear-workspace.json`. Repos without one still work — just pass `--profile`/`--team`.

## Recommended usage

- **Workspaces the hosted claude.ai Linear connector can't reach** (any non-personal
  workspace, e.g. a work or client workspace): `linear-multi-workspaces` is the only path.
  No ambiguity.
- **Your personal workspace**: the hosted connector is already authenticated, richer, and
  was the original intended path — it works fine from inside Conductor too (Conductor
  workspaces are just directories on this Mac; MCP connector access isn't scoped
  per-worktree). Prefer the hosted connector there to avoid two tools writing to the same
  workspace through different code paths. A profile for your personal workspace can still
  exist in `linear-multi-workspaces` as a deliberate fallback in case the hosted connector
  turns out not to be reliably reachable in some Conductor session — if that happens,
  switch to `linear-cli --profile <personal>` for that session and note why.
- When in doubt about which tool created/touched an issue in your personal workspace,
  check `whoami` output and the issue's activity log rather than guessing.

## Script internals

1. **Name→ID resolution** — team/project/label/assignee/state names resolved via
   `@linear/sdk` lookups, cached per-profile (in-memory + on-disk, TTL ~1hr,
   `~/.cache/linear-cli/<profile>.json`, gitignored).
2. **Pagination** — one shared helper (`lib/pagination.mjs`) walks `hasNextPage`/cursor
   for every list/bulk command.
3. **Markdown-safe mutations** — descriptions/comments passed as SDK method arguments,
   never interpolated into query strings.
4. **Structured output** — every command ends with exactly one JSON line on stdout.

## Test record (v1 rollout)

Live-verified against all configured workspaces from this Conductor session:
`whoami`, `create-issue`, `add-comment --quote`, `update-issue --append-section` +
`--state`, `list-issues` with team/state/query filters, `bulk-update` dry-run,
`retire-label` dry-run, `archive-issue` dry-run + `--apply`. Created and assigned a
`CONDUCTOR-TEST` issue in each configured workspace to confirm the full create → assign
path end-to-end per workspace.

## Open questions / future extensions

- File/image attachments — explicitly deferred (see Non-goals).
- Python port — only worth it if avoiding the npm dependency becomes a real constraint;
  `@linear/sdk` being the official typed client is the reason Node was chosen for v1.
- Cross-workspace bulk operations — still out of scope; each invocation targets one
  workspace by design, to keep the blast radius of `bulk-update` bounded.
