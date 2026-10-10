# @crm/mobile

The iOS and Android app: Expo SDK 57, React Native 0.86, Expo Router, TanStack Query, i18next (21 locales).

- **Start here:** [docs/mobile/README.md](../../docs/mobile/README.md) and [docs/mobile/handover.md](../../docs/mobile/handover.md).
- **Run it:** [docs/runbooks/mobile-local-development.md](../../docs/runbooks/mobile-local-development.md).
- **Why it is built this way:** [ADR-0021 to 0027](../../docs/adr/).
- **Rules for agents and people:** [CLAUDE.md](CLAUDE.md).

```bash
pnpm --filter @crm/mobile start        # Metro for a development build (Expo Go cannot run this app)
pnpm --filter @crm/mobile test         # unit and component tests
bash ../../.claude/skills/mobile-pre-pr/scripts/gate.sh   # everything CI runs
```
