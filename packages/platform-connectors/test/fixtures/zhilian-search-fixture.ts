import type { ZhilianSearchTemplates } from '../../src/index.js';

/** 仅用于协议单元测试的最小合成搜索模板与响应。 */
export const zhilianSearchFixture: {
  readonly templates: ZhilianSearchTemplates;
  readonly row: {
    readonly number: string;
    readonly name: string;
    readonly companyNumber: string;
    readonly companyName: string;
    readonly workCity: string;
    readonly salary60: string;
    readonly education: string;
    readonly workingExp: string;
  };
  readonly detail: {
    readonly code: number;
    readonly apiCode: number;
    readonly data: {
      readonly detailedPosition: {
        readonly positionNumber: string;
        readonly positionName: string;
        readonly positionWorkCity: string;
        readonly positionWorkingExp: string;
        readonly salary: string;
        readonly education: string;
        readonly jobDesc: string;
      };
      readonly detailedCompany: { readonly companyNumber: string; readonly companyName: string };
    };
  };
} = {
  templates: {
    list: {
      url: 'https://fe-api.zhaopin.com/c/i/search/positions?at=test-at&rt=test-rt&platform=13&version=0.0.0',
      headers: { 'x-zp-platform': '13', 'x-zp-business-system': '1', Cookie: 'discard-me' },
      body: JSON.stringify({
        S_SOU_FULL_INDEX: '示例岗位',
        S_SOU_WORK_CITY: '101',
        S_SOU_WORK_EXPERIENCE: '0305',
        order: 0,
        actionid: 'test-action',
        pageSize: 20,
        pageIndex: 1,
        cvNumber: 'test-resume',
        at: 'test-at',
        rt: 'test-rt',
        eventScenario: 'pcSearchedSouSearch',
        anonymous: 0,
        resumeNumber: 'test-resume',
        clickFilterBlackCompany: false,
        platform: 13,
        version: '0.0.0',
        sortType: 'DEFAULT',
      }),
    },
    detail: {
      url: 'https://fe-api.zhaopin.com/c/i/jobs/position-detailv3?number=TEST_JOB&at=test-at&rt=test-rt&cvNumber=test-resume&resumeNumber=test-resume&identity=1&platform=13&version=0.0.0',
      headers: { 'x-zp-platform': '13', 'x-zp-business-system': '1' },
    },
  },
  row: {
    number: 'TEST_JOB',
    name: '示例工程师',
    companyNumber: 'TEST_COMPANY',
    companyName: '示例公司',
    workCity: '上海',
    salary60: '面议',
    education: '本科',
    workingExp: '3-5年',
  },
  detail: {
    code: 200,
    apiCode: 200,
    data: {
      detailedPosition: {
        positionNumber: 'TEST_JOB',
        positionName: '示例工程师',
        positionWorkCity: '上海',
        positionWorkingExp: '3-5年',
        salary: '面议',
        education: '本科',
        jobDesc: '<div>负责示例研发。<br><div>编写单元测试。</div></div>',
      },
      detailedCompany: { companyNumber: 'TEST_COMPANY', companyName: '示例公司' },
    },
  },
};
