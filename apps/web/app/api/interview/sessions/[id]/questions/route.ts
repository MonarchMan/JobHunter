import type {
  ProjectQuestionGenerationResult,
  ProjectQuestionGenerationStage,
} from '@jobhunter/application/web';
import { getWebContainer } from '../../../../../../src/server/container.js';
import { verifyMutationRequest } from '../../../../../../src/server/csrf.js';
import { forbiddenResponse } from '../../../../../../src/server/http.js';
import { interviewErrorResponse } from '../../../../../../src/server/interview-http.js';

/** 模块数据结构或契约。 */
interface RouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

/** 问题生成流只公开阶段、最终定位信息或安全错误，不公开未校验问题正文。 */
type QuestionStreamEvent =
  | { readonly type: 'stage'; readonly stage: ProjectQuestionGenerationStage }
  | { readonly type: 'complete'; readonly data: ProjectQuestionGenerationResult }
  | { readonly type: 'error'; readonly error: { readonly message: string } };

/** 将一个完整事件编码为 SSE 消息，浏览器可在模型执行期间立即消费。 */
function encodeEvent(event: QuestionStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

/** 处理 Web API 的 POST 请求，校验输入并提交业务操作。 */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  if (!verifyMutationRequest(request)) return forbiddenResponse();
  try {
    const { id } = await context.params;
    const container = await getWebContainer();
    const controller = new AbortController();
    let closed = false;
    const abort = (): void => {
      controller.abort();
    };
    request.signal.addEventListener('abort', abort, { once: true });

    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        /** 仅在连接仍打开时发送完整事件，客户端取消后不再写流。 */
        const send = (event: QuestionStreamEvent): void => {
          if (!closed) streamController.enqueue(encodeEvent(event));
        };

        // 1、立即返回流；2、转发真实阶段；3、发送最终结果或安全错误；4、释放取消监听。
        void container.services.interview
          .generateQuestion(id, controller.signal, (stage) => {
            send({ type: 'stage', stage });
          })
          .then((result) => {
            send({ type: 'complete', data: result });
          })
          .catch(async (error: unknown) => {
            if (closed) return;
            const response = interviewErrorResponse(error);
            const envelope = (await response.json()) as {
              readonly error?: { readonly message?: string };
            };
            send({
              type: 'error',
              error: { message: envelope.error?.message ?? '无法生成下一题。' },
            });
          })
          .finally(() => {
            request.signal.removeEventListener('abort', abort);
            if (!closed) {
              closed = true;
              streamController.close();
            }
          });
      },
      cancel() {
        // 客户端停止读取时同步中止模型调用，应用服务负责清理未提交占位。
        closed = true;
        abort();
        request.signal.removeEventListener('abort', abort);
      },
    });
    return new Response(stream, {
      headers: {
        'cache-control': 'no-cache, no-transform',
        'content-type': 'text/event-stream; charset=utf-8',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return interviewErrorResponse(error);
  }
}
