## Send limits and live performance (super admin)

Every WhatsApp send is paced per phone number by a Redis governor (`WabaHttp.call`, so campaigns, broadcasts, automations and bot replies share it).
Console: `/admin/whatsapp-throughput` (super admin). API: `platform/waba/throughput`.

- **Rate.** Operator override, else 20 mps for a coexistence number, else the level Meta reports (`STANDARD` 80, `HIGH` 1,000), else the platform default (80),
  less the safety margin (10%). Meta's figures only; nothing else is assumed.
- **Pacing.** GCRA in one Lua script (`wabaGovReserve`), Redis `TIME`, 250 ms burst. A wait over `maxLocalWaitMs` is not reserved: the send is thrown back to its
  queue as a retryable `WabaApiError.held` with the wait.
- **Back-off.** Meta `130429` halves the number's speed (floor 20%) and it recovers linearly over 60 s. `131057` (upgrade in progress) pushes the slot out about 65 s.
  A `phone_number_quality_update` webhook (including `THROUGHPUT_UPGRADE`) re-reads the number from Meta and republishes its limits.
- **Pause.** Stored in `wa_provider_configs.meta_json.send_limits` with the override (no migration). A paused number or a full tier (when enforcement is on)
  throws `AUTH_SEND_HALTED`, the existing pause/retry signal. Broadcasts pause with reason `halt`; `BroadcastResumeService` resumes them every minute and they re-pause
  while the number stays paused (known follow-up: skip paused numbers in the resume sweep).
- **Tier.** Template recipients per hour in HyperLogLog buckets (24 read), an estimate within about 1%. Meta's own count is final. Enforcement is off by default.
- **Refresh.** The worker runs a Redis-locked tick every 5 minutes that republishes limits and re-reads numbers older than `syncIntervalMinutes`.
- **Redis down.** The governor fails open (sends are not paced); the page shows live counters as unavailable.
- **Keys.** `wa:gov:{<phoneNumberId>}:cfg|slot|pen|s:<sec>|m:<min>|t:<hour>|ev|evk:<kind>` and the hash `wa:gov:global`. Settings live in `platform_settings` key `waba.throughput`.
