import { Module } from '@nestjs/common';
import { GetaPublishProvidersModule } from '../../../infra/providers/flow-builder-editor/geta-publish-providers.module';
import { FlowBuilderEditorModule } from '../flow-builder-editor.module';
import { GetaPublishConsumer } from './geta-publish.consumer';

/**
 * What only the worker runs for Geta publishing: the consumer of `flow.geta_publish_requested`, with the port bound to the Geta
 * console adapter or the fixture (`GETA_PUBLISH_MODE`). Imported ONLY by WorkersModule: the HTTP app writes the sync row and the
 * event, it never calls the console.
 */
@Module({
  imports: [FlowBuilderEditorModule, GetaPublishProvidersModule],
  providers: [GetaPublishConsumer],
})
export class FlowBuilderEditorWorkerModule {}
