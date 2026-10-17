/**
 * One shared pagination helper for every list/bulk command.
 * `fetchPage({ first, after })` must return something with `.nodes` and `.pageInfo`
 * (every Linear SDK connection method matches this shape).
 */
export async function paginateAll(fetchPage, { pageSize = 250, maxPages = 40 } = {}) {
  let after;
  const nodes = [];
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage({ first: pageSize, after });
    nodes.push(...page.nodes);
    if (!page.pageInfo?.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  return nodes;
}
