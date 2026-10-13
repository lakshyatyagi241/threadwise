import { Module } from '@nestjs/common';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { DeviceGroupRealtimeConsumer } from './device-group-realtime.consumer';
import { DeviceGroupsSink } from './device-groups.sink';
import { DeviceGroupsSweepService } from './device-groups-sweep.service';
import { WhatsappDevicesBaileysModule } from './whatsapp-devices-baileys.module';

/**
 * The personal-number group directory, worker side: the sink that turns what the sockets read into `wa_device_groups` rows and events, the
 * push to the Groups tab, and the low-frequency refresh sweep. Imported ONLY by WorkersModule: the HTTP app never reads a socket and drains
 * no outbox.
 */
@Module({
  imports: [WhatsappDevicesBaileysModule, NodeBridgeRuntimeModule],
  providers: [DeviceGroupsSink, DeviceGroupRealtimeConsumer, DeviceGroupsSweepService],
})
export class WhatsappDevicesBaileysWorkerModule {}
