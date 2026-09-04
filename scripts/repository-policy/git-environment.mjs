import { execFileSync } from 'node:child_process';

export function withoutInheritedGitEnvironment() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
  );
}

export function runRepositoryGit(repository, args, options = {}) {
  return execFileSync('git', args, {
    cwd: repository,
    env: withoutInheritedGitEnvironment(),
    ...options,
  });
}
