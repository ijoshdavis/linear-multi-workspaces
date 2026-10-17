import { Cache } from "./cache.mjs";
import { paginateAll } from "./pagination.mjs";
import { CliError } from "./output.mjs";

/**
 * Name -> ID resolution for teams/projects/users/labels/workflow states.
 * Each lookup list is fetched once per process and cached to disk (keyed by
 * profile, ~1hr TTL) so a long Claude session doesn't re-list the whole
 * workspace on every single CLI invocation.
 */
export function makeResolver(client, profile) {
  const cache = new Cache(profile);

  async function allTeams() {
    return cache.wrap("teams:all", async () => {
      const teams = await paginateAll((vars) => client.teams(vars));
      return teams.map((t) => ({ id: t.id, key: t.key, name: t.name }));
    });
  }

  async function resolveTeam(nameOrKey) {
    if (!nameOrKey) {
      throw new CliError(
        "MISSING_TEAM",
        "No team resolved. Pass --team <key> or set \"team\" in .claude/linear-workspace.json."
      );
    }
    const teams = await allTeams();
    const needle = nameOrKey.toLowerCase();
    const match = teams.find(
      (t) => t.key.toLowerCase() === needle || t.name.toLowerCase() === needle || t.id === nameOrKey
    );
    if (!match) {
      throw new CliError("TEAM_NOT_FOUND", `No team matches "${nameOrKey}".`, {
        known: teams.map((t) => t.key),
      });
    }
    return match;
  }

  async function allUsers() {
    return cache.wrap("users:all", async () => {
      const users = await paginateAll((vars) => client.users(vars));
      return users.map((u) => ({ id: u.id, email: u.email, name: u.name, displayName: u.displayName }));
    });
  }

  async function resolveUserByEmail(email) {
    if (!email) return undefined;
    const users = await allUsers();
    const needle = email.toLowerCase();
    const match = users.find((u) => u.email?.toLowerCase() === needle || u.id === email);
    if (!match) {
      throw new CliError("USER_NOT_FOUND", `No user matches "${email}".`);
    }
    return match;
  }

  async function allProjects() {
    return cache.wrap("projects:all", async () => {
      const projects = await paginateAll((vars) => client.projects(vars));
      return projects.map((p) => ({ id: p.id, name: p.name }));
    });
  }

  async function resolveProject(nameOrId) {
    if (!nameOrId) return undefined;
    const projects = await allProjects();
    const needle = nameOrId.toLowerCase();
    const match = projects.find((p) => p.name.toLowerCase() === needle || p.id === nameOrId);
    if (!match) {
      throw new CliError("PROJECT_NOT_FOUND", `No project matches "${nameOrId}".`);
    }
    return match;
  }

  async function allLabels() {
    return cache.wrap("labels:all", async () => {
      const labels = await paginateAll((vars) => client.issueLabels(vars));
      return labels.map((l) => ({ id: l.id, name: l.name, teamId: l.teamId ?? null }));
    });
  }

  async function resolveLabel(nameOrId) {
    const labels = await allLabels();
    const needle = nameOrId.toLowerCase();
    const match = labels.find((l) => l.name.toLowerCase() === needle || l.id === nameOrId);
    if (!match) {
      throw new CliError("LABEL_NOT_FOUND", `No label matches "${nameOrId}".`);
    }
    return match;
  }

  async function resolveLabels(csv) {
    if (!csv) return [];
    const names = csv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return Promise.all(names.map(resolveLabel));
  }

  async function allStates() {
    return cache.wrap("states:all", async () => {
      const states = await paginateAll((vars) => client.workflowStates(vars));
      return states.map((s) => ({ id: s.id, name: s.name, teamId: s.teamId ?? null }));
    });
  }

  async function resolveState(nameOrId, teamId) {
    if (!nameOrId) return undefined;
    const states = await allStates();
    const needle = nameOrId.toLowerCase();
    const scoped = teamId ? states.filter((s) => s.teamId === teamId) : states;
    const pool = scoped.length ? scoped : states;
    const match = pool.find((s) => s.name.toLowerCase() === needle || s.id === nameOrId);
    if (!match) {
      throw new CliError("STATE_NOT_FOUND", `No workflow state matches "${nameOrId}".`);
    }
    return match;
  }

  return {
    cache,
    allTeams,
    resolveTeam,
    allUsers,
    resolveUserByEmail,
    allProjects,
    resolveProject,
    allLabels,
    resolveLabel,
    resolveLabels,
    allStates,
    resolveState,
  };
}
