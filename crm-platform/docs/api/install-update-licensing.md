# Install, update and licensing (INST)

Reference ships a browser installer, an in-app updater and a licence check because a buyer uploads it to shared hosting.
This platform is deployed as container images with a migrator, so the deploy-time mechanisms replace most of that.
`docs/threadwise-port/port-map/install-update-licensing.md` lists every TW feature and what became of it.

## Deploy-time contract

| Variable                              | Required      | Meaning                                                                                                                        |
| ------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SETUP_TOKEN`                         | for first run | 32+ characters. Without it `/v2/setup/*` writes answer 403 `SETUP_DISABLED`; create the first operator with `operator:create`. |
| `DEMO_MODE`                           | no            | `true` makes every write 403 `DEMO_MODE_BLOCKED` unless the route is allow-listed or marked `@DemoSafe()`.                     |
| `GIT_SHA`, `BUILD_NUMBER`, `BUILT_AT` | no            | Reported on the System page.                                                                                                   |

Order of a first deploy: run `pnpm db:migrate` (the migrator image), start the API with `SETUP_TOKEN`, open `/setup`.

## Endpoints

| Method and path               | Auth                | Notes                                                                                                                                                |
| ----------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v2/setup/status`        | public              | `open` or `completed`, whether a token is configured, prerequisite checks                                                                            |
| `POST /v2/setup/verify-token` | public              | 403 `SETUP_TOKEN_INVALID` on mismatch (constant-time compare)                                                                                        |
| `POST /v2/setup/bootstrap`    | public + token body | first platform operator (super admin, must enrol MFA), first organization and admin, lock; one transaction, 409 `SETUP_ALREADY_COMPLETED` afterwards |
| `GET /v2/platform/system`     | any operator        | release, uptime, setup state, migration ledger, database and Redis checks; read-only                                                                 |

## Updating

Forward-only migrations (repo rule 3): deploy the new image, run the migrator, restart. A rollback is the previous
image plus a database restore; there is no browser-driven code overwrite.
