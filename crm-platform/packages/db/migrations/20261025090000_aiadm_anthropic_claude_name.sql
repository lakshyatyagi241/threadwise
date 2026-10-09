-- WaDesk lists the Anthropic provider card as "Anthropic Claude" (its seed migration names it so).
UPDATE admin_ai_keys SET name = 'Anthropic Claude' WHERE provider = 'anthropic' AND name = 'Anthropic';
