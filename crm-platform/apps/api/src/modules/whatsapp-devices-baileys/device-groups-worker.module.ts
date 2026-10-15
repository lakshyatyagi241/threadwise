import { Module } from '@nestjs/common';
import { ChatConversationsModule } from '../chat-conversations';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { DeviceGroupRealtimeConsumer } from './device-group-realtime.consumer';
import { DeviceGroupsSink } from './device-groups.sink';
import { HistoryImportRealtimeConsumer } from './history-import-realtime.consumer';
import { HistoryImportSink } from './history-import.sink';
import { HistoryImportSweepService } from './history-import-sweep.service';
import { DeviceGroupsSweepService } from './device-groups-sweep.service';
import { WhatsappDevicesBaileysModule } from './whatsapp-devices-baileys.module';

/**
 * The personal-number group directory, worker side: the sink that turns what the sockets read into `wa_device_groups` rows and events, the
 * push to the Groups tab, the low-frequency refresh sweep, and the history import's importer and sweep. Imported ONLY by WorkersModule: the HTTP app never reads a socket and drains
 * no outbox.
 */
@Module({
  imports: [WhatsappDevicesBaileysModule, NodeBridgeRuntimeModule, ChatConversationsModule],
  providers: [
    DeviceGroupsSink,
    DeviceGroupRealtimeConsumer,
    DeviceGroupsSweepService,
    // The opt-in history import of a first link (TW-WAHIST): the quiet importer and the sweep that ends idle runs.
    HistoryImportSink,
    HistoryImportSweepService,
    HistoryImportRealtimeConsumer,
  ],
})
export class WhatsappDevicesBaileysWorkerModule {}
