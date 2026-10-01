-- companies: Reference company fields without a column yet. `website` is `domain`, `owner_user_id` is `owner_id`,
-- `custom_attributes` is `data`.
ALTER TABLE companies
  ADD COLUMN email     citext,
  ADD COLUMN phone     text,
  ADD COLUMN industry  text,
  ADD COLUMN size_range text,
  ADD COLUMN address   text,
  ADD COLUMN notes     text;
