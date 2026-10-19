/**
 * Public surface of the storefront-builder domain. Other domains import from here, never from the folders below.
 * `StoreShell` is the frame of every `/store/*` page (the store sidebar plus the page): the catalog screens
 * (`/store/products`, `/store/reviews`) and the later checkout screens wrap themselves in it.
 */
export { StoreShell } from './admin/components/store-shell';
export { StoreSidebar } from './admin/components/sidebar';
export { useOverview as useStoreOverview } from './admin/api/hooks';
