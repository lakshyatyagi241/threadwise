import type { NavItem } from '../_registry/types';
import { nav as affiliate } from './affiliate/nav';

/** The domain's menu entries: each sub-area (affiliate, coupons, currencies) declares its own and is added here. */
export const nav: NavItem[] = [...affiliate];
