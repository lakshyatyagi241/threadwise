/**
 * Public surface of the Social leads domain. Other domains import from here, never from the folders below.
 * `ContactAttributionCard` is the "Lead attribution" block of the contact page.
 */
export { ContactAttributionCard } from './components/contact-attribution-card';
/** The contact details use the same attribution data as a "Lead source" tab of key-value rows. */
export { useContactAttribution } from './api';
export { attributionView, type AttributionView, type TouchView } from './lib/attribution-view';
