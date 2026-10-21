import {
  webApplicationProgressSchema,
  type WebApplicationProgress,
} from '../contracts/application-progress-web.js';
import type { ApplicationProgressQueryService } from './application-progress-service.js';

/** 将申请进展内部投影转换为 Web 安全响应；不携带邮件正文。 */
export class WebApplicationProgressService {
  readonly #progress: ApplicationProgressQueryService;

  public constructor(progress: ApplicationProgressQueryService) {
    this.#progress = progress;
  }

  /** 返回公司分组、岗位流程条和多轮面试时间线。 */
  public list(): WebApplicationProgress {
    return webApplicationProgressSchema.parse({
      companies: this.#progress.list().map((company) => ({
        key: company.key,
        companyName: company.companyName,
        status: company.status,
        totalApplications: company.totalApplications,
        activeApplications: company.activeApplications,
        actionRequiredApplications: company.actionRequiredApplications,
        latestEventAt: toIso(company.latestEventAt),
        applications: company.applications.map((application) => ({
          id: application.id,
          companyName: application.companyName,
          roleTitle: application.roleTitle,
          status: application.status,
          stage: application.stage,
          statusEffectiveAt: toIso(application.statusEffectiveAt),
          updatedAt: new Date(application.updatedAt).toISOString(),
          latestEventAt: toIso(application.latestEventAt),
          hasActionRequired: application.hasActionRequired,
          rounds: application.rounds.map((round) => ({
            key: round.key,
            roundNo: round.roundNo,
            label: round.label,
            status: round.status,
            sourceEventId: round.sourceEventId,
            schedule: round.schedule,
          })),
          events: application.events.map((event) => ({
            id: event.id,
            eventType: event.eventType,
            effectiveAt: new Date(event.effectiveAt).toISOString(),
            receivedAt: new Date(event.receivedAt).toISOString(),
            stageLabel: event.stageLabel,
            schedule: event.schedule,
            location: event.location,
            meetingUrl: event.meetingUrl,
            actionUrl: event.actionUrl,
            sourceUrl: event.sourceUrl,
          })),
        })),
      })),
    });
  }
}

function toIso(value: number | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}
