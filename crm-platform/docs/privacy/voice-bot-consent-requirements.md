# Voice bot, IVR and call recording: consent requirements

Requirements a voice bot, IVR, ConversationRelay-style AI call assistant or any call recording must meet **before it ships**. Design
context: [privacy-and-data-governance.md](../specs/privacy-and-data-governance.md) section 5. Not legal advice; every region rule below
is a design assumption that counsel must confirm (spec section 10).

## What exists today

- WhatsApp Business Calling: call permission requests and call logs (`apps/api/src/modules/calling-voice/call-permission.service.ts`,
  `apps/api/src/modules/calling-voice/call-logs.service.ts`), recordings in private storage with signed, audited playback
  (`apps/api/src/modules/calling-voice/call-recordings.service.ts`), wiring map
  [calling-voice.md](../threadwise-port/wiring/calling-voice.md).
- Built for operator calls (BL-144): recording is off by default; a versioned notice and the person's recorded answer are required before any audio
  is kept, through `ConsentGate.check(... 'call_recording' ...)`; evidence on the call (method, time, notice version and sha-256); retention sweep
  (default 90 days), manual delete and legal hold; erasure and export via the rights registry. API: [calling-voice.md](../api/calling-voice.md).
  Requirements 2 (partly), 4 (without audio hash), 5, 11 and 12 are met for these calls; 1, 3, 6 to 10 and 13 to 16 belong to the bot.
- Not present (audit): calling windows, DNC checks, any link between calls and the consent ledger, any transcript store (the AI half of the call
  log is BL-108/BL-109, not built), a region rule engine, DTMF capture.
- The AI call assistant and Node bridge are not built, so none of the below is implemented. It is a gate list.

## Requirements

1. **Disclosure of automation.** The first sentence of every AI-handled call says it is an automated assistant. Script text is versioned
   in the purpose registry (`noticeKey`), per language; the version id is stored on the call row.
2. **Recording is off by default** (decision D7), enabled per workspace. When on, the notice says the call is recorded and for what
   purpose; the script is chosen by region.
3. **Region rule engine.** The gate takes a regime hint from the destination number, the caller's number and the workspace setting and
   applies the strictest: one-party consent regions (some US states), all-party consent (several US states, EU/UK practice, many other
   countries), and unknown = all-party. Gulf and India rules are open questions for counsel. Mechanism by region:
   - announcement then continue (only where counsel confirms it is enough);
   - DTMF: "press 1 to continue, the call is recorded";
   - spoken yes captured with speech recognition, with the confirmation phrase stored.
4. **Evidence stored per consent** (extends the ledger evidence rules in
   [contact-consent-ledger.md](../specs/contact-consent-ledger.md) section 3.2): timestamp, prompt/script version and sha-256, method
   (`dtmf`, `spoken_yes`, `announcement_continue`, `wa_call_permission`), audio clip hash for spoken consent (the clip itself kept only as
   long as the recording), call id, provider call sid. Not stored: voiceprint, raw IP.
5. **Refusal path.** If the person declines recording the call continues unrecorded or goes to a human, as the workspace chooses; the bot
   never tells the person that refusing blocks service unless the workspace configured and justified it.
6. **Spoken opt-out detection.** Phrases such as "stop calling me", "do not record", "remove my number", "unsubscribe" (per language,
   configurable like the STOP list) write a `withdrawn` event for voice and, by default, for text marketing too. The bot confirms and
   ends the marketing part. Detection uses the transcript stream; low confidence asks "Do you want us to stop calling?".
7. **Outbound dialing gate** (before a call is placed): consent or an existing relationship for the purpose; STOP applies to voice;
   calling windows in the callee's local time (regime defaults, workspace stricter); do-not-call list check (pluggable per country:
   TRAI registry in India, national lists elsewhere); caller identity shown; attempt limits per day.
8. **WhatsApp Business Calling permission.** The permission a contact grants through Meta's flow is mapped to the ledger as `granted`
   with method `wa_call_permission`, expiry from Meta's rules, withdrawn when Meta reports a revocation. It does not replace the
   recording consent.
9. **Voiceprints and speaker identification are banned** by default (decision D8). Using voice to identify or authenticate a person is a
   separate purpose with explicit consent and a DPIA. Emotion or health inference from voice is banned.
10. **Payments (PCI).** Pause recording and transcription while card data is spoken or keyed; use the provider's secure payment capture;
    mask card-like numbers in transcripts. We must never store a PAN or CVV.
11. **Retention** (spec 4.6): recordings 90 days, transcripts 180 days, overridable inside bounds; the sweep deletes objects in storage
    and rows; legal hold supported.
12. **DSAR.** Recordings and transcripts are registered personal-data holders: export returns audio and text, erasure removes both and the
    derived summaries; the call log row is anonymised, not deleted, so billing stays correct.
13. **Transcripts are personal data** and subject to the same masking as the Help assistant for any LLM use, and to the AI workspace
    switch (`ai_content_processing`).
14. **Minors.** If the caller says they are under the local age of consent, or the contact is tagged as a minor, the bot stops
    recording, stops marketing and hands to a human.
    **Age confirmation (BL-219, requirement only, not built).** Where the workspace asks (spec 11.10 rule 2: never by default), the bot
    asks one neutral yes/no question before any marketing or recording: "Are you at least N years old?" (N is the workspace's minor
    age, `effectivePolicy().minorAge`, else 18). The caller answers by voice or by DTMF ("press 1 for yes, 2 for no"). Evidence on the
    call and in the ledger: method `spoken_age` or `dtmf_age`, the prompt version and its sha-256, the time, the call id; the audio is
    kept only under the call's own recording rules. A "no", a spoken age below N, or no answer after two prompts sets the minor flag
    (source `flow`), stops marketing and recording, says so neutrally and offers a human. The bot never asks for a date of birth by voice
    (the date would sit in a transcript), never states which answer passes, and never repeats the question after a "no".
15. **Sensitive topics.** Health, finance distress, religion, politics: the bot does not probe, does not store extracted facts about
    them, and hands off on request.
16. **Human handoff** is always available ("speak to a person") and logged.
17. **Provider listing.** Telephony, speech-to-text, text-to-speech and LLM vendors are entries in the
    [sub-processor register](subprocessor-register.md) before use; the data they receive, retention they apply and training-on-data terms
    are recorded.
18. **Security.** Recordings in a private bucket with per-object access, signed short-lived URLs, playback and download audited
    (already the pattern), and encryption keys per object as a P2 item (BL-153).
19. **Testing.** Contract tests for: first utterance contains the disclosure; no audio is stored before consent; a withdrawn contact is
    never dialled; a refusal leaves no recording; erasure removes objects.

## Gate calls the voice code must make

```
ConsentGate.check({ subject, channel: 'voice', purpose: 'voice_ai_conversation', modality: 'voice' })  // needs_notice -> play disclosure
ConsentGate.check({ subject, channel: 'voice', purpose: 'call_recording',        modality: 'voice' })  // allow only after consent evidence
ConsentGate.check({ subject, channel: 'voice', purpose: 'marketing_messaging',   modality: 'voice' })  // outbound marketing call: deny without consent, window, DNC
```

## Acceptance checklist for a voice release

- [ ] Disclosure script versioned per language and played first.
- [ ] Recording off by default; notice and consent mechanism per region configured. (Operator calls: done, one text per workspace; per region open.)
- [ ] Evidence recorded for every consent decision. (Operator calls: done.)
- [ ] Spoken and DTMF opt-out work and write ledger events.
- [ ] Calling windows, DNC and STOP enforced by the gate.
- [ ] PCI pause tested.
- [ ] Retention sweep and erasure handlers registered and tested. (Recordings: done, `test/e2e/calling-voice/call-recording-consent.e2e.spec.ts`; transcripts: none stored yet.)
- [ ] Vendors in the sub-processor register with DPA status.
- [ ] Counsel has reviewed scripts and regional rules.
