-- wgt/flb: a website chat widget can belong to a flow bot, and a flow can run on the website chat channel.
-- Why this migration exists: bots are created for one channel. A web bot owns exactly one widget (its look and its install
-- script), made with the bot. `flow_id` links them; a widget with a flow_id is run by the flow runtime instead of an AI
-- assistant. `customized_at` stays null until the owner saves the Customize tab once, which keeps the "needs customizing"
-- reminder on until then. The table keeps its forced RLS and tenant policy: new columns change neither.
ALTER TABLE chatbot_widgets
  ADD COLUMN IF NOT EXISTS flow_id bigint,
  ADD COLUMN IF NOT EXISTS customized_at timestamptz;

ALTER TABLE chatbot_widgets
  ADD CONSTRAINT fk_chatbot_widgets_flow_id
    FOREIGN KEY (org_id, flow_id) REFERENCES flows (org_id, id) ON DELETE CASCADE;

-- One widget per flow bot.
CREATE UNIQUE INDEX uq_chatbot_widgets_flow_id ON chatbot_widgets (org_id, flow_id) WHERE flow_id IS NOT NULL;

ALTER TABLE flows DROP CONSTRAINT chk_flows_flow_type;
ALTER TABLE flows
  ADD CONSTRAINT chk_flows_flow_type CHECK (flow_type IN
    ('chat','call','instagram','facebook','tiktok','telegram','line','wechat','viber','email','web'));
