-- The pull request behind each release, so the operator console can say what a release changes and when it was raised.
-- Written by the `pr` step of deploy/hostinger/ci-entry.sh from what the build server reads off GitHub. Four new nullable columns:
-- expand-only, the live slot never reads them. A release that has no PR on record (an older row, a push without a PR number, a build
-- server without a GitHub token) keeps them NULL.
ALTER TABLE platform_releases
  ADD COLUMN IF NOT EXISTS pr_number     integer     CHECK (pr_number > 0),
  ADD COLUMN IF NOT EXISTS pr_title      text        CHECK (char_length(pr_title) <= 300),
  ADD COLUMN IF NOT EXISTS pr_body       text        CHECK (char_length(pr_body) <= 4000),
  ADD COLUMN IF NOT EXISTS pr_created_at timestamptz;
