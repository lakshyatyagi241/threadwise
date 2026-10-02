import type { ChannelCapabilities } from '@crm/contracts';
import {
  effectiveCapabilities,
  type ChannelAdapter,
  type ChannelRuntime,
} from '../../infra/providers/chat-conversations';

/** What this channel can do: the adapter's own report with the channel's overrides on top. */
export function effectiveCapabilitiesOf(
  adapter: ChannelAdapter,
  channel: ChannelRuntime,
): ChannelCapabilities {
  return effectiveCapabilities(adapter.capabilities(channel), channel.capabilityOverrides);
}
