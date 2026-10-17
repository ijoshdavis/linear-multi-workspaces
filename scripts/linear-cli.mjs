#!/usr/bin/env node
import { parseArgs } from "../lib/args.mjs";
import { resolveConfig } from "../lib/config.mjs";
import { makeClient } from "../lib/linear.mjs";
import { makeResolver } from "../lib/resolve.mjs";
import { paginateAll } from "../lib/pagination.mjs";
import { readTextArg, parseAppendSection } from "../lib/text.mjs";
import { ok, run, CliError } from "../lib/output.mjs";

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);

function requireArg(name) {
  const value = args[name];
  if (value === undefined || value === true) {
    throw new CliError("MISSING_ARG", `--${name} is required.`);
  }
  return value;
}

function context() {
  const config = resolveConfig({ profileFlag: args.profile, teamFlag: args.team });
  const client = makeClient(config);
  const resolver = makeResolver(client, config.profile);
  return { config, client, resolver };
}

async function cmdWhoami() {
  const { config, client, resolver } = context();
  const [viewer, organization] = await Promise.all([client.viewer, client.organization]);
  let team;
  if (config.team) {
    team = await resolver.resolveTeam(config.team).catch(() => undefined);
  }
  ok({
    profile: config.profile,
    markerPath: config.markerPath,
    workspace: { name: organization.name, urlKey: organization.urlKey },
    viewer: { name: viewer.name, email: viewer.email },
    team: team ? { key: team.key, name: team.name } : null,
  });
}

async function cmdCreateIssue() {
  const { config, client, resolver } = context();
  const title = requireArg("title");
  const team = await resolver.resolveTeam(args.team || config.team);
  const description = args["description-file"]
    ? readTextArg(args["description-file"], { label: "description" })
    : undefined;
  const project = args.project ? await resolver.resolveProject(args.project) : undefined;
  const assignee = args.assignee ? await resolver.resolveUserByEmail(args.assignee) : undefined;
  const labels = args.labels ? await resolver.resolveLabels(args.labels) : [];
  const state = args.state ? await resolver.resolveState(args.state, team.id) : undefined;
  const priority = args.priority !== undefined ? Number(args.priority) : undefined;
  if (priority !== undefined && (Number.isNaN(priority) || priority < 0 || priority > 4)) {
    throw new CliError("BAD_ARG", `--priority must be 0-4, got "${args.priority}".`);
  }

  const payload = await client.createIssue({
    teamId: team.id,
    title,
    description,
    projectId: project?.id,
    assigneeId: assignee?.id,
    labelIds: labels.map((l) => l.id),
    stateId: state?.id,
    priority,
  });
  if (!payload.success) {
    throw new CliError("CREATE_FAILED", "Linear reported the issue create as unsuccessful.");
  }
  const issue = await payload.issue;
  ok({ id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url });
}

async function cmdUpdateIssue() {
  const { client, resolver } = context();
  const id = requireArg("id");
  const issue = await client.issue(id);
  if (!issue) throw new CliError("NOT_FOUND", `No issue found for "${id}".`);

  const input = {};
  if (args["description-file"]) {
    input.description = readTextArg(args["description-file"], { label: "description" });
  } else if (args["append-section"]) {
    const { heading, body } = parseAppendSection(args["append-section"]);
    const existing = issue.description ?? "";
    const separator = existing.trim() ? "\n\n" : "";
    input.description = `${existing}${separator}## ${heading}\n\n${body}`;
  }
  if (args.title) input.title = args.title;
  if (args.assignee) input.assigneeId = (await resolver.resolveUserByEmail(args.assignee)).id;
  if (args.labels) input.labelIds = (await resolver.resolveLabels(args.labels)).map((l) => l.id);
  if (args.state) input.stateId = (await resolver.resolveState(args.state, issue.teamId)).id;

  if (Object.keys(input).length === 0) {
    throw new CliError("NO_CHANGES", "No fields to update were provided.");
  }

  const payload = await client.updateIssue(issue.id, input);
  if (!payload.success) {
    throw new CliError("UPDATE_FAILED", "Linear reported the issue update as unsuccessful.");
  }
  const updated = await payload.issue;
  ok({ id: updated.id, identifier: updated.identifier, title: updated.title, url: updated.url });
}

async function cmdAddComment() {
  const { client } = context();
  const issueRef = requireArg("issue");
  const bodyFile = requireArg("body-file");
  const issue = await client.issue(issueRef);
  if (!issue) throw new CliError("NOT_FOUND", `No issue found for "${issueRef}".`);
  const body = readTextArg(bodyFile, { label: "comment body" });

  const payload = await client.createComment({
    issueId: issue.id,
    body,
    quotedText: typeof args.quote === "string" ? args.quote : undefined,
  });
  if (!payload.success) {
    throw new CliError("COMMENT_FAILED", "Linear reported the comment create as unsuccessful.");
  }
  const comment = await payload.comment;
  ok({ id: comment.id, issue: issue.identifier, url: comment.url });
}

async function cmdCreateProject() {
  const { config, client, resolver } = context();
  const name = requireArg("name");
  const team = await resolver.resolveTeam(args.team || config.team);
  const description = args["description-file"]
    ? readTextArg(args["description-file"], { label: "description" })
    : undefined;
  const lead = args.lead ? await resolver.resolveUserByEmail(args.lead) : undefined;

  const payload = await client.createProject({
    name,
    teamIds: [team.id],
    description,
    leadId: lead?.id,
  });
  if (!payload.success) {
    throw new CliError("CREATE_FAILED", "Linear reported the project create as unsuccessful.");
  }
  const project = await payload.project;
  ok({ id: project.id, name: project.name, url: project.url });
}

async function buildIssueFilter({ resolver, config }) {
  const filter = {};
  const teamArg = args.team || config.team;
  const team = teamArg ? await resolver.resolveTeam(teamArg) : undefined;
  if (team) filter.team = { id: { eq: team.id } };
  if (args.state) filter.state = { name: { eq: args.state } };
  if (args.label) filter.labels = { name: { eq: args.label } };
  return { filter, team };
}

async function lookupMaps(resolver) {
  const [states, users, labels] = await Promise.all([
    resolver.allStates(),
    resolver.allUsers(),
    resolver.allLabels(),
  ]);
  return {
    stateById: new Map(states.map((s) => [s.id, s.name])),
    userById: new Map(users.map((u) => [u.id, u.email])),
    labelById: new Map(labels.map((l) => [l.id, l.name])),
  };
}

function describeIssue(issue, maps) {
  return {
    id: issue.identifier,
    title: issue.title,
    url: issue.url,
    priority: issue.priority,
    state: maps.stateById.get(issue.stateId) ?? issue.stateId ?? null,
    assignee: issue.assigneeId ? maps.userById.get(issue.assigneeId) ?? issue.assigneeId : null,
    labels: (issue.labelIds || []).map((id) => maps.labelById.get(id) ?? id),
    updatedAt: issue.updatedAt,
  };
}

async function cmdListIssues() {
  const { config, client, resolver } = context();
  const { filter, team } = await buildIssueFilter({ resolver, config });

  const nodes = args.query
    ? await paginateAll((vars) => client.searchIssues(args.query, { ...vars, teamId: team?.id, filter }))
    : await paginateAll((vars) => client.issues({ ...vars, filter }));

  const maps = await lookupMaps(resolver);
  ok({ count: nodes.length, issues: nodes.map((n) => describeIssue(n, maps)) });
}

async function cmdBulkUpdate() {
  const { config, client, resolver } = context();
  const rawFilter = args.query ? JSON.parse(args.query) : {};
  const teamArg = args.team || config.team;
  const team = teamArg ? await resolver.resolveTeam(teamArg) : undefined;
  const filter = team ? { and: [rawFilter, { team: { id: { eq: team.id } } }] } : rawFilter;

  const nodes = await paginateAll((vars) => client.issues({ ...vars, filter }));
  const apply = args.apply === true;

  if (!apply) {
    ok({
      dryRun: true,
      matched: nodes.length,
      issues: nodes.map((n) => ({ id: n.identifier, title: n.title })),
      hint: "Pass --apply to perform this update.",
    });
    return;
  }

  const setState = requireArg("set-state");
  const state = await resolver.resolveState(setState, team?.id);
  const results = [];
  for (const issue of nodes) {
    const payload = await client.updateIssue(issue.id, { stateId: state.id });
    results.push({ id: issue.identifier, ok: payload.success });
  }
  ok({ dryRun: false, updated: results.length, results });
}

async function cmdArchiveIssue() {
  const { client } = context();
  const id = requireArg("id");
  const issue = await client.issue(id);
  if (!issue) throw new CliError("NOT_FOUND", `No issue found for "${id}".`);
  const apply = args.apply === true;

  if (!apply) {
    ok({
      dryRun: true,
      issue: { id: issue.identifier, title: issue.title },
      hint: "Pass --apply to archive this issue.",
    });
    return;
  }

  const payload = await client.archiveIssue(issue.id);
  ok({ dryRun: false, archived: payload.success, id: issue.identifier });
}

async function cmdRetireLabel() {
  const { resolver, client } = context();
  const name = requireArg("name");
  const label = await resolver.resolveLabel(name);
  const apply = args.apply === true;

  if (!apply) {
    ok({
      dryRun: true,
      label: { id: label.id, name: label.name },
      hint: "Pass --apply to retire this label.",
    });
    return;
  }

  const payload = await client.updateIssueLabel(label.id, { retiredAt: new Date().toISOString() });
  ok({ dryRun: false, retired: payload.success, id: label.id, name: label.name });
}

const commands = {
  whoami: cmdWhoami,
  "create-issue": cmdCreateIssue,
  "update-issue": cmdUpdateIssue,
  "add-comment": cmdAddComment,
  "create-project": cmdCreateProject,
  "list-issues": cmdListIssues,
  "bulk-update": cmdBulkUpdate,
  "archive-issue": cmdArchiveIssue,
  "retire-label": cmdRetireLabel,
};

run(async () => {
  const handler = commands[subcommand];
  if (!handler) {
    throw new CliError(
      "UNKNOWN_COMMAND",
      `Unknown command "${subcommand ?? ""}". Known commands: ${Object.keys(commands).join(", ")}.`
    );
  }
  await handler();
});
