-- camp: stored wizard audiences that used `rules` as a narrowing filter, made safe for the audience step that no longer narrows with it.
-- Why this migration exists: the four-mode audience step (PR 143) made `audience.rules` only the filter of the contacts table; it joins the
-- audience through `allMatching`. A draft or recurring series saved BEFORE that kept `rules` next to `groupIds` / `segmentIds` and meant
-- "in one of these groups AND matching the rules". Read by the new code, such an audience would message the WHOLE group or segment, a
-- silent over-send. A stored audience of the old shape is recognised by `rules` being set with no `allMatching` key (the new shape always
-- writes the key). It is rewritten so nothing is sent to more people than was meant:
--   * rules with groups or segments: the sources are cleared (the narrowing cannot be written in the new shape), so a draft cannot be
--     launched until the audience is chosen again, and an active recurring series is paused;
--   * rules alone: the rules become `allMatching` (everyone the conditions match, which is what they selected before).
-- Launched campaigns are history and are left as they are. Idempotent: a rewritten audience has `allMatching` or no `rules`.

UPDATE wpcampaigns SET wizard = jsonb_set(
  wizard, '{draft,audience}',
  CASE
    WHEN jsonb_array_length(coalesce(wizard #> '{draft,audience,groupIds}', '[]'::jsonb)) > 0
      OR jsonb_array_length(coalesce(wizard #> '{draft,audience,segmentIds}', '[]'::jsonb)) > 0
    THEN (wizard #> '{draft,audience}') || jsonb_build_object('groupIds', '[]'::jsonb, 'segmentIds', '[]'::jsonb, 'rules', 'null'::jsonb)
    ELSE (wizard #> '{draft,audience}') || jsonb_build_object(
      'allMatching', jsonb_build_object('search', 'null'::jsonb, 'rules', wizard #> '{draft,audience,rules}'),
      'rules', 'null'::jsonb)
  END)
WHERE wizard IS NOT NULL AND status = 'draft'
  AND jsonb_typeof(wizard #> '{draft,audience,rules}') = 'object'
  AND NOT ((wizard #> '{draft,audience}') ? 'allMatching');

UPDATE camp_series SET
  status = CASE
    WHEN status = 'active' AND (
      jsonb_array_length(coalesce(blueprint #> '{audience,groupIds}', '[]'::jsonb)) > 0
      OR jsonb_array_length(coalesce(blueprint #> '{audience,segmentIds}', '[]'::jsonb)) > 0) THEN 'paused'
    ELSE status END,
  blueprint = jsonb_set(
    blueprint, '{audience}',
    CASE
      WHEN jsonb_array_length(coalesce(blueprint #> '{audience,groupIds}', '[]'::jsonb)) > 0
        OR jsonb_array_length(coalesce(blueprint #> '{audience,segmentIds}', '[]'::jsonb)) > 0
      THEN (blueprint -> 'audience') || jsonb_build_object('groupIds', '[]'::jsonb, 'segmentIds', '[]'::jsonb, 'rules', 'null'::jsonb)
      ELSE (blueprint -> 'audience') || jsonb_build_object(
        'allMatching', jsonb_build_object('search', 'null'::jsonb, 'rules', blueprint #> '{audience,rules}'),
        'rules', 'null'::jsonb)
    END)
WHERE jsonb_typeof(blueprint #> '{audience,rules}') = 'object'
  AND NOT ((blueprint -> 'audience') ? 'allMatching')
  AND status IN ('active', 'paused');
