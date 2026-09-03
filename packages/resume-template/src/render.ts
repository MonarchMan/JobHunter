import { getResumeTemplate, type ResumeTemplateKey } from './catalog.js';
import {
  resumeDocumentContentSchema,
  resumeSectionLabels,
  type ResumeDocumentContent,
  type ResumeSectionId,
} from './model.js';

function escapeHtml(value: string | null | undefined): string {
  return (value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function editable(path: string, interactive: boolean, placeholder?: string): string {
  return ` data-editable data-field="${path}"${placeholder ? ` data-placeholder="${placeholder}"` : ''}${interactive ? ' contenteditable="true" spellcheck="false"' : ''}`;
}

function sectionStyle(content: ResumeDocumentContent, id: ResumeSectionId): string {
  const style = content.formatting?.[id];
  return style
    ? ` style="--section-font-size:${String(style.fontSize)}px;--section-letter-spacing:${String(style.letterSpacing)}px;--section-line-height:${String(style.lineHeight)}"`
    : '';
}

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const sectionIcons: Readonly<Record<ResumeSectionId, string>> = {
  basic: svg('<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>'),
  target: svg(
    '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="m16 8 4-4m0 0v4m0-4h-4"/>',
  ),
  education: svg('<path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 12v5c3 2 7 2 10 0v-5m4-3v6"/>'),
  work: svg(
    '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18M10 12v2h4v-2"/>',
  ),
  projects: svg('<path d="m8 9-4 3 4 3m8-6 4 3-4 3m-3-8-2 10"/>'),
  works: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 9v11"/>'),
  competitions: svg(
    '<path d="M8 4h8v3c0 4-1.8 6-4 6S8 11 8 7V4Z"/><path d="M8 6H4v1c0 3 2 5 5 5m7-6h4v1c0 3-2 5-5 5m-3 1v4m-4 3h8m-6-3h4"/>',
  ),
  certificates: svg(
    '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1 7 4.5-2 4.5 2-1-7M9.5 9l1.6 1.6L15 7"/>',
  ),
  languages: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  ),
  skills: svg(
    '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9h6v6H9zM9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3"/>',
  ),
  evaluation: svg(
    '<path d="M12 3 4 7v5c0 5 3.4 8 8 9 4.6-1 8-4 8-9V7l-8-4Z"/><path d="m9 12 2 2 4-5"/>',
  ),
};

const contactIcons = {
  phone: svg(
    '<path d="M7 3H4.5A1.5 1.5 0 0 0 3 4.5C3 13.6 10.4 21 19.5 21a1.5 1.5 0 0 0 1.5-1.5V17l-4-1-1.1 2.2a15.7 15.7 0 0 1-10.1-10L8 7 7 3Z"/>',
  ),
  email: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  location: svg(
    '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  ),
  website: svg(
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
  ),
} as const;

function section(
  id: ResumeSectionId,
  body: string,
  content: ResumeDocumentContent,
  active?: ResumeSectionId,
  interactive = false,
): string {
  if (!body.trim()) return '';
  return `<section class="resume-section${active === id ? ' is-active' : ''}" data-section-id="${id}"${sectionStyle(content, id)}${interactive ? ' tabindex="0"' : ''}><div class="section-heading"><span class="section-icon" aria-hidden="true">${sectionIcons[id]}</span><h2>${resumeSectionLabels[id]}</h2><span class="section-rule"></span></div><div class="section-body">${body}</div></section>`;
}

function lines(items: readonly string[], path: string, interactive: boolean): string {
  const content = items
    .filter((item) => interactive || item.trim())
    .map(
      (item, index) =>
        `<li${editable(`${path}.${String(index)}`, interactive, '输入一条描述')}>${escapeHtml(item)}</li>`,
    )
    .join('');
  return content ? `<ul class="detail-list">${content}</ul>` : '';
}

function professionalSkills(value: string | null, interactive: boolean): string {
  const items = (value ?? '')
    .split(/\r?\n|(?<=[。；;])\s*/u)
    .map((item) => item.replace(/^\s*[-•·]\s*/u, '').trim())
    .filter(Boolean);
  if (interactive && items.length === 0) items.push('');
  if (items.length === 0) return '';
  return `<ul class="detail-list skills-list" data-multiline${editable('professionalSkills', interactive)}>${items.map((item) => `<li data-placeholder="输入一条完整的技能描述">${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function cards(content: ResumeDocumentContent, interactive: boolean): Record<string, string> {
  const education = content.education
    .filter((item) => interactive || [item.institution, item.degree, item.field].some(Boolean))
    .map(
      (item, index) =>
        `<article class="entry"><div class="entry-head"><strong${editable(`education.${String(index)}.institution`, interactive, '学校名称')}>${escapeHtml(item.institution)}</strong><span><span${editable(`education.${String(index)}.startDate`, interactive, '开始日期')}>${escapeHtml(item.startDate)}</span><span aria-hidden="true"> — </span><span${editable(`education.${String(index)}.endDate`, interactive, '结束日期')}>${escapeHtml(item.endDate)}</span></span></div><p><span${editable(`education.${String(index)}.degree`, interactive, '学历')}>${escapeHtml(item.degree)}</span><span aria-hidden="true"> · </span><span${editable(`education.${String(index)}.field`, interactive, '专业')}>${escapeHtml(item.field)}</span></p></article>`,
    )
    .join('');
  const work = content.workExperience
    .filter(
      (item) =>
        interactive || [item.organization, item.title, item.highlights.length > 0].some(Boolean),
    )
    .map(
      (item, index) =>
        `<article class="entry timeline-entry"><span class="timeline-dot" aria-hidden="true"></span><div class="entry-head"><strong><span class="entry-mark" aria-hidden="true">${sectionIcons.work}</span><span${editable(`workExperience.${String(index)}.organization`, interactive, '公司 / 组织')}>${escapeHtml(item.organization)}</span></strong><span><span${editable(`workExperience.${String(index)}.startDate`, interactive, '开始日期')}>${escapeHtml(item.startDate)}</span><span aria-hidden="true"> — </span><span${editable(`workExperience.${String(index)}.endDate`, interactive, '结束日期')}>${escapeHtml(item.endDate)}</span></span></div><h3${editable(`workExperience.${String(index)}.title`, interactive, '职位')}>${escapeHtml(item.title)}</h3>${lines(item.highlights, `workExperience.${String(index)}.highlights`, interactive)}</article>`,
    )
    .join('');
  const projects = content.projects
    .filter(
      (item) => interactive || [item.name, item.role, item.highlights.length > 0].some(Boolean),
    )
    .map(
      (item, index) =>
        `<article class="entry timeline-entry"><span class="timeline-dot" aria-hidden="true"></span><div class="entry-head"><strong><span class="entry-mark" aria-hidden="true">${sectionIcons.projects}</span><span${editable(`projects.${String(index)}.name`, interactive, '项目名称')}>${escapeHtml(item.name)}</span></strong><span><span${editable(`projects.${String(index)}.startDate`, interactive, '开始日期')}>${escapeHtml(item.startDate)}</span><span aria-hidden="true"> — </span><span${editable(`projects.${String(index)}.endDate`, interactive, '结束日期')}>${escapeHtml(item.endDate)}</span></span></div><h3${editable(`projects.${String(index)}.role`, interactive, '项目角色')}>${escapeHtml(item.role)}</h3>${lines(item.highlights, `projects.${String(index)}.highlights`, interactive)}</article>`,
    )
    .join('');
  const works = content.works
    .filter((item) => interactive || [item.name, item.description, item.url].some(Boolean))
    .map(
      (item, index) =>
        `<article class="entry"><div class="entry-head"><strong${editable(`works.${String(index)}.name`, interactive, '作品名称')}>${escapeHtml(item.name)}</strong><span${editable(`works.${String(index)}.url`, interactive, '作品链接')}>${escapeHtml(item.url)}</span></div><p${editable(`works.${String(index)}.description`, interactive, '作品说明')}>${escapeHtml(item.description)}</p></article>`,
    )
    .join('');
  const competitions = content.competitions
    .filter((item) => interactive || [item.name, item.award, item.date].some(Boolean))
    .map(
      (item, index) =>
        `<article class="compact-entry"><strong${editable(`competitions.${String(index)}.name`, interactive, '竞赛名称')}>${escapeHtml(item.name)}</strong><span${editable(`competitions.${String(index)}.award`, interactive, '奖项')}>${escapeHtml(item.award)}</span><time${editable(`competitions.${String(index)}.date`, interactive, '时间')}>${escapeHtml(item.date)}</time></article>`,
    )
    .join('');
  const certificates = content.certificates
    .filter((item) => interactive || [item.name, item.issuer, item.date].some(Boolean))
    .map(
      (item, index) =>
        `<article class="compact-entry"><strong${editable(`certificates.${String(index)}.name`, interactive, '证书名称')}>${escapeHtml(item.name)}</strong><span${editable(`certificates.${String(index)}.issuer`, interactive, '颁发机构')}>${escapeHtml(item.issuer)}</span><time${editable(`certificates.${String(index)}.date`, interactive, '取得时间')}>${escapeHtml(item.date)}</time></article>`,
    )
    .join('');
  const languages = content.languages
    .filter((item) => interactive || [item.name, item.proficiency].some(Boolean))
    .map(
      (item, index) =>
        `<span class="tag"><span${editable(`languages.${String(index)}.name`, interactive, '语言')}>${escapeHtml(item.name)}</span><span aria-hidden="true"> · </span><span${editable(`languages.${String(index)}.proficiency`, interactive, '熟练程度')}>${escapeHtml(item.proficiency)}</span></span>`,
    )
    .join('');
  return { education, work, projects, works, competitions, certificates, languages };
}

const sharedCss = `
*{box-sizing:border-box}html{background:#e9edf4}body{margin:0;color:#1c2430;font:14px/1.55 "Aptos","PingFang SC","Microsoft YaHei",sans-serif}.resume-paper{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:13mm 14mm 12mm}.hero{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:start;padding-bottom:18px}.hero.has-avatar{grid-template-columns:30mm minmax(0,1fr)}.avatar{width:28mm;height:36mm;object-fit:cover;border:1px solid #d7e0ec}.profile-kicker{display:none}.identity{font-size:var(--section-font-size,inherit);letter-spacing:var(--section-letter-spacing,normal);line-height:var(--section-line-height,inherit)}.identity-title{display:flex;align-items:baseline;justify-content:flex-start;gap:16px}.identity h1{margin:0;font-size:30px;letter-spacing:-.04em;line-height:1.15}.role-line{flex:1 1 45%;margin:0;color:#596275;font-weight:750;text-align:left}.contact{display:flex;flex-wrap:wrap;gap:5px 14px;margin-top:11px;color:#596275;font-size:12px}.contact-icon,.section-icon,.entry-mark,.timeline-dot{display:none}.resume-section{position:relative;margin-top:18px;break-inside:auto}.section-body{font-size:var(--section-font-size,inherit);letter-spacing:var(--section-letter-spacing,normal);line-height:var(--section-line-height,inherit)}.section-heading{display:flex;align-items:center;gap:10px;margin-bottom:9px}.section-heading h2{margin:0;font-size:16px;letter-spacing:.04em}.section-rule{height:2px;flex:1;background:#dbe3ef}.entry{position:relative;padding:9px 0;break-inside:avoid}.entry+.entry{border-top:1px solid #e3e8f0}.entry-head{display:flex;justify-content:space-between;gap:16px}.entry-head>span{color:#657188;font-size:12px;text-align:right}.entry h3,.entry p{margin:3px 0}.entry h3{font-size:13px}.detail-list{margin:5px 0 0;padding-left:18px}.detail-list li{margin:2px 0}.skills-list{white-space:normal}.compact-entry{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto;gap:12px;padding:5px 0;break-inside:avoid}.compact-entry time,.compact-entry span{color:#657188}.tag-list{display:flex;flex-wrap:wrap;gap:6px}.tag{display:inline-block;padding:3px 8px;border:1px solid #d7e0ec;border-radius:4px}.copy{white-space:pre-wrap}.is-active{outline:2px solid #4e5fbb;outline-offset:5px}.is-active:before{content:"";position:absolute;left:-9px;top:0;width:3px;height:30px;background:#e06c5d}[contenteditable=true]{min-width:1ch;cursor:text;outline:0;border-radius:2px}[contenteditable=true]:hover{background:rgb(50 108 255 / 7%)}[contenteditable=true]:focus{background:#fff;box-shadow:0 0 0 2px #7897ff}[contenteditable=true]:empty:before,[contenteditable=true] [data-placeholder]:empty:before{color:#8b95a7;content:attr(data-placeholder)}.export-toolbar{position:sticky;z-index:5;top:0;display:flex;gap:8px;justify-content:center;padding:10px;background:#111827;color:#fff}.export-toolbar button{border:1px solid #94a3b8;border-radius:6px;background:#fff;color:#111827;padding:7px 11px;cursor:pointer}.export-toolbar+main{margin-top:16px}@page{size:A4;margin:0}@media print{html,body{width:210mm;background:#fff}.export-toolbar{display:none!important}.resume-paper{margin:0;box-shadow:none}.is-active{outline:none}.is-active:before{display:none}}
`;

const technicalCss = `
body.template-one-page{font-size:12px;line-height:1.42;color:#263247}body.template-one-page .resume-paper{padding:9mm 11mm 9mm;border-top:3px solid #111827}body.template-one-page .hero{min-height:36mm;align-items:center;gap:5mm;padding:4mm 4.5mm;background:#fff;border:1px solid #d7e0ec;border-radius:1.5mm}body.template-one-page .hero.has-avatar{grid-template-columns:24mm minmax(0,1fr)}body.template-one-page .avatar{width:23mm;height:29mm;padding:1px;background:#fff;border-color:#cad6e5;border-radius:1mm}body.template-one-page .profile-kicker{display:block;margin-bottom:1.5mm;color:#4d5a72;font-size:8px;font-weight:850;letter-spacing:.09em}body.template-one-page .identity h1{font-size:27px;font-weight:900;color:#111;letter-spacing:-.025em}body.template-one-page .role-line{max-width:none;color:#596275;font-size:13px;font-weight:800;line-height:1.35;letter-spacing:.015em}body.template-one-page .contact{gap:1.5mm;margin-top:2.5mm}body.template-one-page .contact-chip{display:inline-flex;min-height:7mm;align-items:center;gap:1.5mm;padding:1mm 2mm;color:#303b4e;background:#f8faff;border:1px solid #d1dae7;border-radius:1.2mm;font-size:9px;white-space:nowrap}body.template-one-page .contact-icon{display:inline-flex;width:3.6mm;height:3.6mm;color:#326cff}body.template-one-page .contact-icon svg{width:100%;height:100%}body.template-one-page .resume-section{margin-top:3.2mm}body.template-one-page .section-heading{display:grid;grid-template-columns:6.5mm auto minmax(0,1fr);gap:2mm;margin-bottom:1.8mm}body.template-one-page .section-icon{display:grid;width:6.5mm;height:6.5mm;place-items:center;color:#326cff;background:#eef4ff;border-radius:1.6mm}body.template-one-page .section-icon svg{width:4.1mm;height:4.1mm}body.template-one-page .section-heading h2{font-size:14px;font-weight:900;line-height:1;letter-spacing:.02em;color:#151b28}body.template-one-page .section-rule{height:1.5px;background:linear-gradient(90deg,#326cff,#d7e2ff)}body.template-one-page [data-section-id="education"] .section-body,body.template-one-page [data-section-id="works"] .section-body,body.template-one-page [data-section-id="competitions"] .section-body,body.template-one-page [data-section-id="certificates"] .section-body,body.template-one-page [data-section-id="languages"] .section-body,body.template-one-page [data-section-id="skills"] .section-body,body.template-one-page [data-section-id="evaluation"] .section-body{padding:2mm 2.5mm;background:#f7f9fc;border:1px solid #d7e0ec;border-radius:1.7mm}body.template-one-page .entry{padding:1.4mm 0}body.template-one-page .entry:first-child{padding-top:0}body.template-one-page .entry:last-child{padding-bottom:0}body.template-one-page .entry-head{align-items:baseline}body.template-one-page .entry-head strong{display:flex;align-items:center;gap:1.4mm;color:#111827;font-weight:900}body.template-one-page .entry-head>span{font-size:9px;font-weight:700}body.template-one-page .entry h3{font-size:10.5px;font-weight:800;color:#475569}body.template-one-page .entry-mark{display:inline-grid;width:4mm;height:4mm;place-items:center;flex:0 0 auto;color:#326cff;background:#eef4ff;border-radius:1mm}body.template-one-page .entry-mark svg{width:2.6mm;height:2.6mm}body.template-one-page [data-section-id="work"] .section-body,body.template-one-page [data-section-id="projects"] .section-body{margin-left:2.7mm;padding-left:3.5mm;border-left:2.5px solid #e5edff}body.template-one-page .timeline-entry{padding:0 0 2.2mm;border:0}body.template-one-page .timeline-entry+.timeline-entry{padding-top:.4mm;border:0}body.template-one-page .timeline-dot{position:absolute;left:-5.35mm;top:1.1mm;display:block;width:2.5mm;height:2.5mm;background:#326cff;border:1.5px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #bed0ff}body.template-one-page .detail-list{margin:.8mm 0 0;padding-left:4.5mm}body.template-one-page .detail-list li{margin:.4mm 0}body.template-one-page .detail-list li::marker{color:#e9784d}body.template-one-page .compact-entry{gap:2mm;padding:.8mm 0}body.template-one-page .tag-list{gap:1.2mm}body.template-one-page .tag{padding:.6mm 1.8mm;color:#244cac;background:#eef4ff;border-color:#bed0ff;border-radius:999px;font-size:9.5px;font-weight:800}body.template-one-page .copy{margin:0;line-height:1.55}body.template-one-page .is-active{outline-color:#4e5fbb}body.template-one-page .is-active:before{left:-2mm;background:#e06c5d}@media print{body.template-one-page{font-size:12px;-webkit-print-color-adjust:exact;print-color-adjust:exact}body.template-one-page .resume-paper{padding:9mm 11mm 9mm}}
`;

const cleanCss = `
body.template-clean{color:#20242c}body.template-clean .resume-paper{padding:15mm 17mm}body.template-clean .hero{border-bottom:2px solid #20242c}body.template-clean .identity h1{font-family:Georgia,"Songti SC",serif;font-size:32px;font-weight:600}body.template-clean .role-line{color:#4e5fbb}body.template-clean .resume-section{margin-top:15px}body.template-clean .section-heading{margin-bottom:5px}body.template-clean .section-heading h2{font-size:14px;text-transform:uppercase}body.template-clean .section-heading span{height:1px;background:#aeb5c2}body.template-clean .entry{padding:7px 0}body.template-clean .tag{border:0;border-bottom:1px solid #aeb5c2;border-radius:0;padding:2px 0;margin-right:10px}
`;

const editableScript = `<script>(()=>{const q=(s,r=document)=>r.querySelector(s);const qa=(s,r=document)=>[...r.querySelectorAll(s)];const set=(on)=>qa('[data-editable]').forEach(n=>on?n.setAttribute('contenteditable','true'):n.removeAttribute('contenteditable'));q('[data-action=edit]').addEventListener('click',e=>{const on=e.currentTarget.dataset.on!=='true';e.currentTarget.dataset.on=String(on);e.currentTarget.textContent=on?'结束编辑':'编辑文字';set(on)});q('[data-action=print]').addEventListener('click',()=>window.print());q('[data-action=save]').addEventListener('click',()=>{const copy=document.documentElement.cloneNode(true);qa('[contenteditable]',copy).forEach(n=>n.removeAttribute('contenteditable'));const edit=q('[data-action=edit]',copy);if(edit){edit.dataset.on='false';edit.textContent='编辑文字'}const source='<!doctype html>\\n'+copy.outerHTML;const url=URL.createObjectURL(new Blob([source],{type:'text/html;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=(q('h1')?.textContent?.trim()||'我的简历')+'-简历.html';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)})})();</script>`;

export interface RenderResumeHtmlInput {
  readonly templateKey: ResumeTemplateKey;
  readonly templateVersion?: number;
  readonly content: ResumeDocumentContent;
  readonly avatarDataUrl?: string | null;
  readonly activeSection?: ResumeSectionId;
  readonly editable?: boolean;
  readonly interactive?: boolean;
}

export function renderResumeHtml(input: RenderResumeHtmlInput): string {
  const template = getResumeTemplate(input.templateKey, input.templateVersion);
  const content = resumeDocumentContentSchema.parse(input.content);
  const interactive = input.interactive ?? false;
  const rendered = cards(content, interactive);
  const contact = [
    { value: content.basicInfo.phone, icon: contactIcons.phone, field: 'phone', label: '手机号码' },
    { value: content.basicInfo.email, icon: contactIcons.email, field: 'email', label: '邮箱' },
    {
      value: content.basicInfo.location,
      icon: contactIcons.location,
      field: 'location',
      label: '所在城市',
    },
    {
      value: content.basicInfo.website,
      icon: contactIcons.website,
      field: 'website',
      label: '个人主页',
    },
  ]
    .filter((item) => interactive || Boolean(item.value))
    .map(
      (item) =>
        `<span class="contact-chip"><span class="contact-icon" aria-hidden="true">${item.icon}</span><span${editable(`basicInfo.${item.field}`, interactive, item.label)}>${escapeHtml(item.value)}</span></span>`,
    )
    .join('');
  const avatar = input.avatarDataUrl
    ? `<img class="avatar" src="${escapeHtml(input.avatarDataUrl)}" alt="个人头像">`
    : '';
  const sections = [
    section('education', rendered.education ?? '', content, input.activeSection, interactive),
    section('work', rendered.work ?? '', content, input.activeSection, interactive),
    section('projects', rendered.projects ?? '', content, input.activeSection, interactive),
    section('works', rendered.works ?? '', content, input.activeSection, interactive),
    section('competitions', rendered.competitions ?? '', content, input.activeSection, interactive),
    section('certificates', rendered.certificates ?? '', content, input.activeSection, interactive),
    section(
      'languages',
      rendered.languages ? `<div class="tag-list">${rendered.languages}</div>` : '',
      content,
      input.activeSection,
      interactive,
    ),
    section(
      'skills',
      professionalSkills(content.professionalSkills, interactive),
      content,
      input.activeSection,
      interactive,
    ),
    section(
      'evaluation',
      content.selfEvaluation || interactive
        ? `<p class="copy" data-multiline${editable('selfEvaluation', interactive, '输入自我评价')}>${escapeHtml(content.selfEvaluation)}</p>`
        : '',
      content,
      input.activeSection,
      interactive,
    ),
  ].join('');
  const exportToolbar = input.editable
    ? `<div class="export-toolbar"><button type="button" data-action="edit">编辑文字</button><button type="button" data-action="save">保存当前 HTML</button><button type="button" data-action="print">打印 / 导出 PDF</button></div>`
    : '';
  const bodyClass = template.key === 'technical-blueprint' ? 'template-one-page' : 'template-clean';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.basicInfo.name ?? '我的简历')} - ${escapeHtml(template.name)}</title><style>${sharedCss}${technicalCss}${cleanCss}</style></head><body class="${bodyClass}">${exportToolbar}<main class="resume-paper"><header class="hero${avatar ? ' has-avatar' : ''}${input.activeSection === 'basic' ? ' is-active' : ''}" data-section-id="basic"${sectionStyle(content, 'basic')}${interactive ? ' tabindex="0"' : ''}>${avatar}<div class="identity"><div class="profile-kicker">个人简历 / RESUME</div><div class="identity-title"><h1${editable('basicInfo.name', interactive, '姓名')}>${escapeHtml(content.basicInfo.name ?? (interactive ? '' : '姓名'))}</h1><p class="role-line"${editable('targetRoles', interactive, '求职方向')}>${escapeHtml(content.targetRoles.join(' / '))}</p></div><div class="contact">${contact}</div></div></header>${sections}</main>${input.editable ? editableScript : ''}</body></html>`;
}
