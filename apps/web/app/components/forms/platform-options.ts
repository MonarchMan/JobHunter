/** 职位与来源页面共用平台名称和本地 Logo。 */
export const platformOptions = (
  [
    ['boss', 'BOSS 直聘'],
    ['zhilian', '智联招聘'],
    ['51job', '前程无忧'],
    ['liepin', '猎聘'],
  ] as const
).map(([value, label]) => ({ value, label, iconSrc: `/assets/company-logos/${value}.jpg` }));
