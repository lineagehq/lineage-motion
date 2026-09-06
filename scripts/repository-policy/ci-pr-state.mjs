export async function currentPullRequest(event, env = process.env, request = fetch) {
  const number = event.number;
  if (!Number.isSafeInteger(number) || number < 1
    || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? '')
    || !env.GITHUB_TOKEN) throw new Error('CI_PR_LOOKUP_CONFIGURATION_INVALID');
  const response = await request(`${env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/pulls/${number}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' }, signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error('CI_PR_LOOKUP_FAILED');
  const current = await response.json();
  if (current.number !== number || current.state !== 'open' || typeof current.draft !== 'boolean'
    || ![current.head?.sha, current.base?.sha].every((sha) => typeof sha === 'string' && /^[a-f0-9]{40}$/.test(sha))) {
    throw new Error('CI_PR_STATE_INVALID');
  }
  if (current.head.sha !== event.pull_request?.head?.sha) throw new Error('CI_PR_HEAD_CHANGED');
  return current;
}
