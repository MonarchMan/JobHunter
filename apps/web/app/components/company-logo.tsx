import type { ReactElement } from 'react';
import styles from './company-logo.module.css';

const companyLogoPaths: Readonly<Record<string, string>> = {
  腾讯: '/assets/company-logos/tencent.png',
  阿里巴巴: '/assets/company-logos/alibaba.png',
  百度: '/assets/company-logos/baidu.png',
  字节跳动: '/assets/company-logos/bytedance.svg',
  拼多多: '/assets/company-logos/pinduoduo.png',
  美团: '/assets/company-logos/meituan.png',
  得物: '/assets/company-logos/dewu.png',
  小红书: '/assets/company-logos/xiaohongshu.ico',
  京东: '/assets/company-logos/jd.ico',
  华为: '/assets/company-logos/huawei.png',
  '360': '/assets/company-logos/qihoo360.png',
  OPPO: '/assets/company-logos/oppo.svg',
  vivo: '/assets/company-logos/vivo.png',
  小米: '/assets/company-logos/xiaomi.ico',
  网易: '/assets/company-logos/netease.ico',
};

export function CompanyLogo({
  name,
  size = 'medium',
  variant = 'default',
}: Readonly<{
  name: string;
  size?: 'small' | 'medium';
  variant?: 'default' | 'source-heading';
}>): ReactElement {
  const source = companyLogoPaths[name];
  const sizeClass = size === 'small' ? styles.small : styles.medium;
  const variantClass = variant === 'source-heading' ? styles.sourceHeading : undefined;
  return (
    <span
      className={[styles.logo, sizeClass, variantClass].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      {source ? (
        <img src={source} alt="" width={32} height={32} />
      ) : (
        <span>{name.slice(0, 1)}</span>
      )}
    </span>
  );
}
