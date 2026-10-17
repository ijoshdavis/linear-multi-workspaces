---
name: linear-multi-workspaces
description: Scriptable Linear operations for workspaces the hosted claude.ai Linear connector can't reach. Use for "create a Linear issue/project", "refine the spec in LIN-123", "add a comment to LIN-123", "clean up stale issues", or any Linear create/update/comment/audit/cleanup task in a non-default workspace.
---

# linear-multi-workspaces

A CLI + credential/profile model for doing real work in Linear workspaces outside the
one hosted claude.ai connector covers. Built on `@linear/sdk` (Linear's official typed
client) so entity resolution, mutation shapes, and pagination are handled by Linear's own
code, not hand-rolled GraphQL.

## Rules for Claude

1. **Always go through the script.** Never call Linear's GraphQL API directly. Every
   operation is `node <skill-dir>/scripts/linear-cli.mjs <subcommand> [flags]`.
2. **Always pass long text via stdin**, not as a shell argument: `--description-file -`
   or `--body-file -`, piping the markdown in. This sidesteps all quoting/escaping.
3. **Always parse the JSON on stdout** and check `"ok"` before reporting success to the
   user. On `"ok": false`, surface `error.message` — never raw SDK/GraphQL errors.
4. **Run `whoami` before the first write in a session** touching a given workspace, so a
   wrong profile/team surfaces before any mutation, not after.
5. **`bulk-update`, `archive-issue`, and `retire-label` default to dry-run.** They print
   what *would* change and make no changes unless `--apply` is passed. Only pass `--apply`
   after showing the dry-run result to the user, or when they've explicitly pre-approved it.
6. If a command fails with `NO_PROFILE` or `NO_CREDENTIAL_FOR_PROFILE`, stop and tell the
   user what's missing (repo marker or credential entry) — don't guess a profile.

## Setup (once per machine, once per repo)

**Credentials** (never committed, lives outside any repo):
`~/.config/linear-cli/credentials.json`, `chmod 600`:
```json
{ "work-main": "lin_api_...", "some-other-profile": "lin_api_..." }
```
Get a Personal API Key from a workspace's Settings → Security & access → API keys.

**Per-repo marker** (committed, non-secret): `.claude/linear-workspace.json` in the repo
you want tied to a given Linear workspace/team:
```json
{ "profile": "work-main", "team": "ENG" }
```
`--profile` and `--team` flags override the marker for one-off calls. See
`.claude/linear-workspace.json.example` in this skill for the shape.

## Commands

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

`--id`/`--issue` accept either the human identifier (`DD-123`) or the UUID.
`bulk-update`'s `--query` is a raw JSON `IssueFilter` (Linear's GraphQL filter shape), not
free text — e.g. `'{"title":{"containsIgnoreCase":"stale"}}'`.

Every command prints exactly one JSON line:
```json
{"ok": true, "data": {...}}
{"ok": false, "error": {"code": "NOT_FOUND", "message": "..."}}
```

## Porting to another project

This whole directory is the skill. To make it available:
- **Globally** (all repos on this Mac): symlink or copy it to `~/.claude/skills/linear-multi-workspaces`.
- **One project**: copy it to `<project>/.claude/skills/linear-multi-workspaces`.

Either way, run `npm install` once inside the copy (installs `@linear/sdk`), then add a
`.claude/linear-workspace.json` marker to whichever repo's work should resolve to that
Linear workspace/team by default.
