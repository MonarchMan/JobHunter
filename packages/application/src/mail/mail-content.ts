import type { ExternalMailMessage } from '@jobhunter/mail-core';
import { convert } from 'html-to-text';
import { z } from 'zod';

// 招聘事实通常集中在正文前部；将模型输入限制在有界窗口，避免长邮件线程耗尽模型预算。
const MAX_CURRENT_BODY_CHARS = 24_000;
const MAX_QUOTED_BODY_CHARS = 4_000;

/** 发送给招聘邮件候选规则和模型的有界正文，不包含附件内容或完整邮件头。 */
export const preparedRecruitmentMailSchema = z
  .object({
    subject: z.string().max(1_000),
    senderName: z.string().max(320),
    senderDomain: z.string().max(253),
    receivedAt: z.number().int().nonnegative(),
    currentBody: z.string().max(MAX_CURRENT_BODY_CHARS),
    quotedHistory: z.string().max(MAX_QUOTED_BODY_CHARS).nullable(),
    sourceKind: z.enum(['plain', 'html', 'empty']),
    wasTruncated: z.boolean(),
  })
  .strict();

export type PreparedRecruitmentMail = z.infer<typeof preparedRecruitmentMailSchema>;

/** 将连接器邮件转换为不执行 HTML、不读取附件的分类输入。 */
export function prepareRecruitmentMail(message: ExternalMailMessage): PreparedRecruitmentMail {
  // 1、优先使用有效纯文本；HTML 仅静态转换为文本，不加载图片、样式、脚本或其他资源。
  const plainText = normalizeText(message.textBody);
  const htmlText = message.htmlBody ? normalizeText(htmlToText(message.htmlBody)) : '';
  const useHtml =
    htmlText.length > 0 && (plainText.length < 20 || htmlText.length > plainText.length * 2);
  const source = useHtml ? htmlText : plainText;
  const sourceKind = source.length === 0 ? 'empty' : useHtml ? 'html' : 'plain';

  // 2、把当前消息与引用历史分开；模型优先理解当前内容，只获得有限引用上下文。
  const split = splitQuotedHistory(source);
  const wasTruncated =
    split.current.length > MAX_CURRENT_BODY_CHARS || split.quoted.length > MAX_QUOTED_BODY_CHARS;
  return preparedRecruitmentMailSchema.parse({
    subject: normalizeText(message.subject).slice(0, 1_000),
    senderName: normalizeText(message.fromName).slice(0, 320),
    senderDomain: senderDomain(message.fromAddress),
    receivedAt: message.receivedAt,
    currentBody: split.current.slice(0, MAX_CURRENT_BODY_CHARS),
    quotedHistory: split.quoted ? split.quoted.slice(0, MAX_QUOTED_BODY_CHARS) : null,
    sourceKind,
    wasTruncated,
  });
}

/** 静态提取 HTML 可见文本；忽略表单、媒体和脚本节点，链接仅保留原始 HTTPS 地址文本。 */
function htmlToText(html: string): string {
  const visibleText = convert(html, {
    baseElements: { selectors: ['body'] },
    wordwrap: false,
    preserveNewlines: true,
    limits: {
      maxInputLength: 400_000,
      maxChildNodes: 20_000,
      maxDepth: 30,
    },
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'img', format: 'skip' },
      { selector: 'svg', format: 'skip' },
      { selector: 'form', format: 'skip' },
      { selector: 'button', format: 'inline' },
      {
        selector: 'a',
        options: { hideLinkHrefIfSameAsText: true, noAnchorUrl: true, baseUrl: undefined },
      },
    ],
  });
  const editorText = extractRichEditorText(html);
  // Moka 等招聘系统会把正文放在 DraftJS 的 data-text 节点中，普通可见性规则可能将其误判为隐藏内容。
  return normalizeText(editorText).length > 0 ? editorText : visibleText;
}

/** 提取富文本编辑器明确标记的正文文本，避免只留下省略号和退订页脚。 */
function extractRichEditorText(html: string): string {
  const fragments = [
    ...html.matchAll(/<span\b[^>]*\bdata-text=["']true["'][^>]*>([\s\S]*?)<\/span>/giu),
  ]
    .map((match) => match[1] ?? '')
    .filter((value) => value.length > 0);
  if (fragments.length === 0) return '';
  // 只解析已截取的内联片段，不执行 HTML，也不允许请求任何远程资源。
  return convert(fragments.join('<br>'), {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'script', format: 'skip' },
      { selector: 'style', format: 'skip' },
      { selector: 'img', format: 'skip' },
      { selector: 'svg', format: 'skip' },
    ],
  });
}

/** 统一空白、Unicode 和不可见字符，避免模板排版影响规则或模型判断。 */
function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/gu, '')
    .replace(/\r\n?/gu, '\n')
    .replace(/[\t\f\v ]+/gu, ' ')
    .replace(/ *\n */gu, '\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

/** 识别常见转发和回复边界，避免旧线程中的拒绝或邀请覆盖当前语义。 */
function splitQuotedHistory(value: string): { current: string; quoted: string } {
  const markers = [
    /^-{2,}\s*Original Message\s*-{2,}$/imu,
    /^_{2,}\s*$/mu,
    /^On .{1,300} wrote:$/imu,
    /^在 .{1,300}写道[:：]$/mu,
    /^(?:From|发件人)[:：].+$/imu,
  ];
  const indexes = markers
    .map((pattern) => pattern.exec(value)?.index)
    .filter((index): index is number => index !== undefined && index > 0);
  if (indexes.length === 0) return { current: value, quoted: '' };
  const boundary = Math.min(...indexes);
  return {
    current: value.slice(0, boundary).trim(),
    quoted: value.slice(boundary).trim(),
  };
}

/** 只把域名作为模板辅助信号，不向模型发送完整发件地址。 */
function senderDomain(address: string): string {
  const normalized = address.trim().toLocaleLowerCase();
  const separator = normalized.lastIndexOf('@');
  return separator < 0 ? '' : normalized.slice(separator + 1, separator + 254);
}
