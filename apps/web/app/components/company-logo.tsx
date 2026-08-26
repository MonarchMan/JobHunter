import type { ReactElement } from 'react';

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
};

export function CompanyLogo({ name, size = 'medium' }: Readonly<{ name: string; size?: 'small' | 'medium' }>): ReactElement {
  const source = companyLogoPaths[name];
  return (
    <span className={`company-logo company-logo-${size}`} aria-hidden="true">
      {source ? <img src={source} alt="" width={32} height={32} /> : <span>{name.slice(0, 1)}</span>}
    </span>
  );
}
