# Waboo exporter

`bin/mongo-export.cjs` copies the collections of one Waboo MongoDB database into canonical Extended JSON, one document per line.
It is read-only: it runs `mongosh` on the jump host over ssh (`find`, `countDocuments`, `getCollectionNames` only) and reads the
documents from its stdout. The connection string goes to the jump host on stdin and is scrubbed from everything this program prints or logs.

This is the exporter that `pilot/staging/cycle.cjs` calls (`MONGO_EXPORT_BIN`); its behaviour is pinned by
`pilot/test/mongo-export.test.cjs` and `pilot/test/mongo-export-ssh.test.cjs` (`node --test tools/migration/pilot/test`).

```
node exporter/bin/mongo-export.cjs --db <db> --client <key> --registry-classes MIGRATE,MIGRATE_LATER --to-ssh --i-confirm-server-is-staging
node exporter/bin/mongo-export.cjs --db <db> --client <key> --collections contact_list,user --out <encrypted dir> --i-confirm-encrypted-volume
```

Setup: copy `env.example` to `.env` (or set `MONGO_EXPORT_ENV`). For `--to-ssh` also set `STAGING_SERVER_ENV` to the staging `server.env`
(`SERVER_HOST`, `SERVER_USER`, `SSH_KEY`). The full list of flags and exit codes is in the header of the script.

Rules it enforces: `chatbot_misc_config` and `auth_logs` and every registry `EXCLUDE` collection are refused (override needs
`--i-know-what-i-am-doing --reason "..."`), `system.*` never; password and credential-named keys are removed from the `user` collection
on the jump host; a dump is refused inside a git repository, a synced-cloud folder or a network path; every file is counted against
`countDocuments()` (exit 3 on a mismatch) and, for `--to-ssh`, re-hashed on the server before it is renamed into place.
Registry dispositions are read from `<tool-dir>/registry/index.ts` with Node's type stripping (Node 22.18+), so no `tsx` is needed.
