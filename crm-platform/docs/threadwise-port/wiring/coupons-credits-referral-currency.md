# Wiring map: coupons-credits-referral-currency (CPN), referral half

| Row                                 | Where                                                                                                                                                 | Status |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Affiliate screen                    | web `/account/affiliate`; API `GET /v2/me/referral`, `/v2/me/referrals`, `/v2/me/referrals/export`; no permission key (own data)                      | built  |
| Code issue                          | worker consumer on `auth.signup_completed`; lazy on the first `/me/referral` read; table `referral_codes`                                             | built  |
| `?ref` capture                      | `apps/web/src/proxy.ts` cookie `crm_ref` (30 days, httpOnly, lax); the sign-up route and the social callback add it to the request                    | built  |
| Attribution                         | auth `SignupService` emits `referral.attributed`; worker consumer writes `referrals`                                                                  | built  |
| Reward                              | worker consumer on `paygw.order.paid` -> `WalletLedgerService.post`; setting `wallet.economics.referralSignupMinor` (wallet rules screen, TW-CPN-034) | built  |
| Reward event                        | `referral.rewarded` outbox event (no consumer yet; a referrer notification is not in Reference)                                                          | built  |
| More-hub counters (TW-037)          | merged into the Affiliate screen KPI strip                                                                                                            | built  |
| Mobile `GET api/app/affiliate/code` | MOB domain; can read `ReferralCodeService.ensure`                                                                                                     | open   |
