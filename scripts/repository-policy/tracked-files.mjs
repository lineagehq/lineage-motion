import { runRepositoryGit } from './git-environment.mjs';

export function trackedFiles(repositoryRoot) {
  const output = runRepositoryGit(repositoryRoot, ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return output
    .split('\0')
    .filter(Boolean)
    .map((path) => path.replaceAll('\\', '/'))
    .sort();
}
