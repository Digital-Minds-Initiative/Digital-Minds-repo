// Conventional Commits: https://www.conventionalcommits.org
// Checked locally on every commit (Husky) and on the PR title in CI, because feature PRs are
// squash-merged and the PR title becomes the commit message on `develop`.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Subjects may be written in English or Arabic, so letter case is not enforced.
    'subject-case': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
  },
};
