// Conventional Commits: https://www.conventionalcommits.org
// Checked locally on every commit (Husky) and on the PR title in CI, because we squash-merge
// and the PR title becomes the commit message on `main`.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subjects may be written in English or Arabic, so letter case is not enforced.
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
