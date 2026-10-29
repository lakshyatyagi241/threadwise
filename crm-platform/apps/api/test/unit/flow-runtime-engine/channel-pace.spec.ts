import { describe, expect, it } from 'vitest';
import {
  CLOUD_PACE_MS,
  profileOf,
} from '../../../src/modules/flow-runtime-engine/runtime/channel-render';

describe('the pause between nodes', () => {
  it('the WhatsApp Cloud API pauses between nodes so Meta delivers them in the flow order', () => {
    expect(profileOf('whatsapp_cloud').paceMs).toBe(CLOUD_PACE_MS);
    expect(CLOUD_PACE_MS).toBeGreaterThan(0);
  });
  it('the simulator does not pause', () => {
    expect(profileOf('simulator').paceMs).toBe(0);
  });
});
