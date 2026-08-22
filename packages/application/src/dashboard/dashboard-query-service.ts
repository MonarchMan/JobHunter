import { webDashboardSchema, type WebDashboard } from '../contracts/web.js';

export interface DashboardReadModel {
  snapshot(): WebDashboard;
}

export class DashboardQueryService {
  readonly #reader: DashboardReadModel;

  public constructor(reader: DashboardReadModel) {
    this.#reader = reader;
  }

  public get(): WebDashboard {
    return webDashboardSchema.parse(this.#reader.snapshot());
  }
}
