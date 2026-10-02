/**
 * Public surface of the install-update-licensing domain. Other modules import from here, never from the files
 * behind it (architecture rule: no cross-module internals).
 */
export { InstallUpdateLicensingModule } from './install-update-licensing.module';
export { DemoSafe } from './demo-mode.guard';
export { ReleaseInfoService } from './release-info.service';
