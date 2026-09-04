import { webDashboardSchema, type WebDashboard } from '../contracts/web.js';

/** 应用层数据结构或端口契约。 */
export interface DashboardReadModel {
  snapshot(): WebDashboard;
}

/** 将数据库仪表盘读模型适配为 Web 契约。 */
export class DashboardQueryService {
  readonly #reader: DashboardReadModel;

  public constructor(reader: DashboardReadModel) {
    this.#reader = reader;
  }

  /** 获取当前仪表盘快照。 */
  public get(): WebDashboard {
    return webDashboardSchema.parse(this.#reader.snapshot());
  }
}
