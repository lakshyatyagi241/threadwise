import type { ReactNode } from 'react';
import { WechatProviders } from '@/features/channel-wechat/components/wechat-providers';

/** Shared frame of the WeChat screens: the toast region. */
export default function WechatDomainLayout({ children }: { children: ReactNode }) {
  return <WechatProviders>{children}</WechatProviders>;
}
