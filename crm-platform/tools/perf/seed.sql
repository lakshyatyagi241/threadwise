-- QA #50: fill ONE organisation with enough rows that latency means something. Latency on an empty database proves nothing.
--   psql "$MIGRATION_DATABASE_URL" -v org=perf-org -v contacts=100000 -v companies=5000 -v tasks=20000 \
--        -v conversations=50000 -v messages=1000000 -f tools/perf/seed.sql
-- Runs as the database owner (the app role cannot cross tenants). Safe to run on a throwaway database only: it adds rows, it never deletes.
-- Everything is generate_series and cheap arithmetic, so the data is reproducible: the same arguments give the same shape.
\set ON_ERROR_STOP on
\if :{?org} \else \set org perf-org \endif
\if :{?contacts} \else \set contacts 100000 \endif
\if :{?companies} \else \set companies 5000 \endif
\if :{?tasks} \else \set tasks 20000 \endif
\if :{?conversations} \else \set conversations 50000 \endif
\if :{?messages} \else \set messages 1000000 \endif

SELECT id AS org_id FROM organizations WHERE slug = :'org' \gset
\if :{?org_id} \else \echo 'no organisation with that slug: sign one up first'; \quit \endif

-- One statement per transaction on purpose: foreign-key checks against rows inserted in the same open transaction are many times slower.
SET synchronous_commit = off;

INSERT INTO companies (org_id, id, name)
SELECT :org_id, 1000000 + g, 'Company ' || g || ' ' || (ARRAY['Ltd','Inc','GmbH','LLC','Pvt'])[1 + g % 5]
FROM generate_series(1, :companies) g;

INSERT INTO contacts (org_id, id, first_name, last_name, name, email, phone, normalized_email, normalized_phone, company_id, status, lifecycle_stage)
SELECT :org_id, 1000000 + g,
       (ARRAY['Aarav','Maya','Chen','Fatima','Lucas','Olga','Yuki','Noor','Sam','Ines'])[1 + g % 10],
       'Lastname' || g,
       (ARRAY['Aarav','Maya','Chen','Fatima','Lucas','Olga','Yuki','Noor','Sam','Ines'])[1 + g % 10] || ' Lastname' || g,
       'person' || g || '@perf.example.test', '+9198' || lpad(g::text, 8, '0'),
       'person' || g || '@perf.example.test', '9198' || lpad(g::text, 8, '0'),
       1000000 + 1 + g % :companies,
       (ARRAY['active','lead','customer'])[1 + g % 3],
       (ARRAY['new','qualified','customer','lost'])[1 + g % 4]
FROM generate_series(1, :contacts) g;

ANALYZE companies; ANALYZE contacts;
INSERT INTO tags (org_id, id, name, color)
SELECT :org_id, 1000000 + g, 'perf-tag-' || g, '#3366ff' FROM generate_series(1, 50) g;

INSERT INTO tasks (org_id, id, title)
SELECT :org_id, 1000000 + g, 'Follow up ' || g FROM generate_series(1, :tasks) g;

INSERT INTO channels (org_id, id, kind, name, status)
VALUES (:org_id, 1000000, 'whatsapp_cloud', 'Perf channel', 'connected');

INSERT INTO conversations (org_id, id, contact_id, title, preview, status, channel_id, peer_key, peer_name, last_message_at, msg_seq, unread_count)
SELECT :org_id, 1000000 + g, 1000000 + 1 + g % :contacts, 'Conversation ' || g, 'Last message preview ' || g,
       (ARRAY['open','open','open','resolved'])[1 + g % 4], 1000000, '9198' || lpad(g::text, 8, '0'), 'Peer ' || g,
       now() - (g % 60) * interval '1 day' - (g % 1440) * interval '1 minute', :messages / :conversations, g % 3
FROM generate_series(1, :conversations) g;

-- messages land in the monthly partitions that exist today (the last 40 days), spread evenly over the conversations.
INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, body, status, created_at)
SELECT :org_id, 1000000 + 1 + g % :conversations, 1 + g / :conversations,
       CASE WHEN g % 2 = 0 THEN 'in' ELSE 'out' END, CASE WHEN g % 2 = 0 THEN 'customer' ELSE 'agent' END,
       'Message body number ' || g || ' with a little more text so rows have a realistic width',
       CASE WHEN g % 2 = 0 THEN 'received' ELSE 'delivered' END,
       now() - ((g::bigint * 7919) % 57600) * interval '1 minute'
FROM generate_series(1, :messages) g;

ANALYZE companies; ANALYZE contacts; ANALYZE tasks; ANALYZE conversations; ANALYZE messages; ANALYZE tags;
SELECT (SELECT count(*) FROM contacts WHERE org_id = :org_id) AS contacts,
       (SELECT count(*) FROM companies WHERE org_id = :org_id) AS companies,
       (SELECT count(*) FROM tasks WHERE org_id = :org_id) AS tasks,
       (SELECT count(*) FROM conversations WHERE org_id = :org_id) AS conversations,
       (SELECT count(*) FROM messages WHERE org_id = :org_id) AS messages;
