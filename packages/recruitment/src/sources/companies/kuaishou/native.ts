/** 等待固定模块在官方运行时注册；入口模块不一定保留在 chunk 队列中。 */
export function kuaishouRuntimeReady(): boolean {
  // 1、webpack 尚未接管队列时等待，避免重复向原始数组注入桥接模块。
  interface Require {
    m: Record<string, unknown>;
  }
  const root = globalThis as unknown as {
    webpackJsonp?: { push: (value: unknown) => unknown };
    __jobhunterKuaishouRequire?: Require;
  };
  if (!root.webpackJsonp || root.webpackJsonp.push === Array.prototype.push) return false;
  if (!root.__jobhunterKuaishouRequire) {
    root.webpackJsonp.push([
      ['jobhunter_kuaishou_bridge'],
      {
        jobhunter_kuaishou_bridge: (_module: unknown, _exports: unknown, require: Require) => {
          root.__jobhunterKuaishouRequire = require;
        },
      },
      [['jobhunter_kuaishou_bridge']],
    ]);
  }
  // 2、只检查已验证的模块路径，不扫描或尝试其他候选模块。
  return (
    typeof root.__jobhunterKuaishouRequire?.m['./src/services/api/DefaultApi.ts'] === 'function'
  );
}

/** 页面内仅执行已核验的原始 API 方法；此函数序列化后不能依赖模块闭包。 */
export async function invokeKuaishouRuntime(input: {
  campus: boolean;
  operation: 'list' | 'projects' | 'dictionaries';
  pageNum?: number;
  pageSize?: number;
  nature?: string;
  project?: string;
}): Promise<unknown> {
  // 1、只连接已加载的官方 webpack4 运行时，不下载/替换模块，不生成或复制签名。
  type Api = Record<string, (params: unknown) => Promise<unknown>>;
  type Require = (path: string) => { DefaultApi?: new () => Api; a?: Api };
  const root = globalThis as unknown as {
    __jobhunterKuaishouRequire?: Require;
    __jobhunterKuaishouApi?: Api;
  };
  if (!root.__jobhunterKuaishouApi) {
    const requireModule = root.__jobhunterKuaishouRequire;
    if (!requireModule) throw new Error('Official runtime bridge changed.');
    const exports = requireModule('./src/services/api/DefaultApi.ts');
    // 1.a、校园站导出已初始化实例，主站导出构造器；这是已验证的两种固定形态。
    if (input.campus) {
      if (!exports.a || typeof exports.a !== 'object')
        throw new Error('Official API export changed.');
      root.__jobhunterKuaishouApi = exports.a;
    } else {
      if (typeof exports.DefaultApi !== 'function') throw new Error('Official API export changed.');
      root.__jobhunterKuaishouApi = new exports.DefaultApi();
    }
  }
  // 2、固定操作白名单与参数；调用官网自身 AJAX 客户端处理匿名会话。
  const api = root.__jobhunterKuaishouApi;
  let method: string;
  let params: unknown;
  if (input.operation === 'projects' && input.campus) {
    method = 'v1OpenSubProjectListUsingGet';
    params = { pageNum: 1, pageSize: 100 };
  } else if (input.operation === 'dictionaries' && !input.campus) {
    method = 'getDictMapUsingGET';
    params = { types: 'workLocation,positionCategory,positionExperience,positionNature' };
  } else if (input.operation === 'list' && input.pageNum && input.pageSize) {
    method = input.campus ? 'indexUsingPOST' : 'positionSimpleUsingGET';
    if (input.campus && !input.project) throw new Error('Campus project is required.');
    if (!input.campus && !['C001', 'C002'].includes(input.nature ?? ''))
      throw new Error('Recruitment nature is invalid.');
    params = {
      pageNum: input.pageNum,
      pageSize: input.pageSize,
      ...(input.campus
        ? { recruitSubProjectCodes: [input.project] }
        : {
            positionNatureCode: input.nature,
            ...(input.nature === 'C001' ? { recruitProject: 'socialr' } : {}),
          }),
    };
  } else throw new Error('Unsupported official operation.');
  const call = api[method];
  if (typeof call !== 'function') throw new Error('Official API method changed.');
  return call.call(api, params);
}
