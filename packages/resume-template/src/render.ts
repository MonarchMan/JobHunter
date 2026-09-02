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

function period(start: string | null, end: string | null): string {
  return [start, end].filter(Boolean).join(' — ');
}

function section(id: ResumeSectionId, body: string, active?: ResumeSectionId): string {
  if (!body.trim()) return '';
  return `<section class="resume-section${active === id ? ' is-active' : ''}" data-section-id="${id}"><div class="section-heading"><h2>${resumeSectionLabels[id]}</h2><span></span></div>${body}</section>`;
}

function lines(items: readonly string[]): string {
  const content = items
    .filter((item) => item.trim())
    .map((item) => `<li data-editable>${escapeHtml(item)}</li>`)
    .join('');
  return content ? `<ul class="detail-list">${content}</ul>` : '';
}

function cards(content: ResumeDocumentContent): Record<string, string> {
  const education = content.education
    .filter((item) => [item.institution, item.degree, item.field].some(Boolean))
    .map(
      (item) =>
        `<article class="entry"><div class="entry-head"><strong data-editable>${escapeHtml(item.institution)}</strong><span data-editable>${escapeHtml(period(item.startDate, item.endDate))}</span></div><p data-editable>${escapeHtml([item.degree, item.field].filter(Boolean).join(' · '))}</p></article>`,
    )
    .join('');
  const work = content.workExperience
    .filter((item) => [item.organization, item.title, item.highlights.length > 0].some(Boolean))
    .map(
      (item) =>
        `<article class="entry timeline-entry"><div class="entry-head"><strong data-editable>${escapeHtml(item.organization)}</strong><span data-editable>${escapeHtml(period(item.startDate, item.endDate))}</span></div><h3 data-editable>${escapeHtml(item.title)}</h3>${lines(item.highlights)}</article>`,
    )
    .join('');
  const projects = content.projects
    .filter((item) => [item.name, item.role, item.highlights.length > 0].some(Boolean))
    .map(
      (item) =>
        `<article class="entry timeline-entry"><div class="entry-head"><strong data-editable>${escapeHtml(item.name)}</strong><span data-editable>${escapeHtml(period(item.startDate, item.endDate))}</span></div><h3 data-editable>${escapeHtml(item.role)}</h3>${lines(item.highlights)}</article>`,
    )
    .join('');
  const works = content.works
    .filter((item) => [item.name, item.description, item.url].some(Boolean))
    .map(
      (item) =>
        `<article class="entry"><div class="entry-head"><strong data-editable>${escapeHtml(item.name)}</strong><span data-editable>${escapeHtml(item.url)}</span></div><p data-editable>${escapeHtml(item.description)}</p></article>`,
    )
    .join('');
  const competitions = content.competitions
    .filter((item) => [item.name, item.award, item.date].some(Boolean))
    .map(
      (item) =>
        `<article class="compact-entry"><strong data-editable>${escapeHtml(item.name)}</strong><span data-editable>${escapeHtml(item.award)}</span><time data-editable>${escapeHtml(item.date)}</time></article>`,
    )
    .join('');
  const certificates = content.certificates
    .filter((item) => [item.name, item.issuer, item.date].some(Boolean))
    .map(
      (item) =>
        `<article class="compact-entry"><strong data-editable>${escapeHtml(item.name)}</strong><span data-editable>${escapeHtml(item.issuer)}</span><time data-editable>${escapeHtml(item.date)}</time></article>`,
    )
    .join('');
  const languages = content.languages
    .filter((item) => [item.name, item.proficiency].some(Boolean))
    .map(
      (item) =>
        `<span class="tag" data-editable>${escapeHtml([item.name, item.proficiency].filter(Boolean).join(' · '))}</span>`,
    )
    .join('');
  return { education, work, projects, works, competitions, certificates, languages };
}

const sharedCss = `
*{box-sizing:border-box}html{background:#e9edf4}body{margin:0;color:#1c2430;font:14px/1.55 "Aptos","PingFang SC","Microsoft YaHei",sans-serif}.resume-paper{width:210mm;min-height:297mm;margin:0 auto;background:#fff;padding:13mm 14mm 12mm}.hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:start;padding-bottom:18px}.hero.has-avatar{grid-template-columns:30mm minmax(0,1fr)}.avatar{width:28mm;height:36mm;object-fit:cover;border:1px solid #d7e0ec}.identity h1{margin:0;font-size:30px;letter-spacing:-.04em;line-height:1.15}.role-line{margin:8px 0 0;color:#326cff;font-weight:700}.contact{display:flex;flex-wrap:wrap;gap:5px 14px;margin-top:11px;color:#596275;font-size:12px}.resume-section{position:relative;margin-top:18px;break-inside:auto}.section-heading{display:flex;align-items:center;gap:10px;margin-bottom:9px}.section-heading h2{margin:0;font-size:16px;letter-spacing:.04em}.section-heading span{height:2px;flex:1;background:#dbe3ef}.entry{padding:9px 0;break-inside:avoid}.entry+.entry{border-top:1px solid #e3e8f0}.entry-head{display:flex;justify-content:space-between;gap:16px}.entry-head>span{color:#657188;font-size:12px;text-align:right}.entry h3,.entry p{margin:3px 0}.entry h3{font-size:13px}.detail-list{margin:5px 0 0;padding-left:18px}.detail-list li{margin:2px 0}.compact-entry{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr) auto;gap:12px;padding:5px 0;break-inside:avoid}.compact-entry time,.compact-entry span{color:#657188}.tag-list{display:flex;flex-wrap:wrap;gap:6px}.tag{display:inline-block;padding:3px 8px;border:1px solid #d7e0ec;border-radius:4px}.copy{white-space:pre-wrap}.is-active{outline:2px solid #4e5fbb;outline-offset:5px}.is-active:before{content:"";position:absolute;left:-9px;top:0;width:3px;height:30px;background:#e06c5d}.export-toolbar{position:sticky;z-index:5;top:0;display:flex;gap:8px;justify-content:center;padding:10px;background:#111827;color:#fff}.export-toolbar button{border:1px solid #94a3b8;border-radius:6px;background:#fff;color:#111827;padding:7px 11px;cursor:pointer}.export-toolbar+main{margin-top:16px}[contenteditable=true]{outline:1px dashed #326cff;outline-offset:2px}@page{size:A4;margin:0}@media print{html,body{width:210mm;background:#fff}.export-toolbar{display:none!important}.resume-paper{margin:0;box-shadow:none}.is-active{outline:none}.is-active:before{display:none}}
`;

const technicalCss = `
body.template-technical .resume-paper{border-top:4px solid #111827}body.template-technical .hero{padding:13px;background:#f7f9fc;border:1px solid #d7e0ec}body.template-technical .section-heading h2{color:#111827}body.template-technical .section-heading span{background:linear-gradient(90deg,#326cff,#d7e2ff)}body.template-technical .timeline-entry{padding-left:16px;border-left:2px solid #d7e2ff}body.template-technical .tag{border-color:#bed0ff;background:#eef4ff;color:#244cac}
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
}

export function renderResumeHtml(input: RenderResumeHtmlInput): string {
  const template = getResumeTemplate(input.templateKey, input.templateVersion ?? 1);
  const content = resumeDocumentContentSchema.parse(input.content);
  const rendered = cards(content);
  const contact = [
    content.basicInfo.phone,
    content.basicInfo.email,
    content.basicInfo.location,
    content.basicInfo.website,
  ]
    .filter(Boolean)
    .map((item) => `<span data-editable>${escapeHtml(item)}</span>`)
    .join('');
  const avatar = input.avatarDataUrl
    ? `<img class="avatar" src="${escapeHtml(input.avatarDataUrl)}" alt="个人头像">`
    : '';
  const sections = [
    section(
      'target',
      content.targetRoles
        .map((role) => `<span class="tag" data-editable>${escapeHtml(role)}</span>`)
        .join(''),
      input.activeSection,
    ),
    section('education', rendered.education ?? '', input.activeSection),
    section('work', rendered.work ?? '', input.activeSection),
    section('projects', rendered.projects ?? '', input.activeSection),
    section('works', rendered.works ?? '', input.activeSection),
    section('competitions', rendered.competitions ?? '', input.activeSection),
    section('certificates', rendered.certificates ?? '', input.activeSection),
    section(
      'languages',
      `<div class="tag-list">${rendered.languages ?? ''}</div>`,
      input.activeSection,
    ),
    section(
      'skills',
      content.professionalSkills
        ? `<p class="copy" data-editable>${escapeHtml(content.professionalSkills)}</p>`
        : '',
      input.activeSection,
    ),
    section(
      'evaluation',
      content.selfEvaluation
        ? `<p class="copy" data-editable>${escapeHtml(content.selfEvaluation)}</p>`
        : '',
      input.activeSection,
    ),
  ].join('');
  const editable = input.editable
    ? `<div class="export-toolbar"><button type="button" data-action="edit">编辑文字</button><button type="button" data-action="save">保存当前 HTML</button><button type="button" data-action="print">打印 / 导出 PDF</button></div>`
    : '';
  const bodyClass =
    template.key === 'technical-blueprint' ? 'template-technical' : 'template-clean';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(content.basicInfo.name ?? '我的简历')} - ${escapeHtml(template.name)}</title><style>${sharedCss}${technicalCss}${cleanCss}</style></head><body class="${bodyClass}">${editable}<main class="resume-paper"><header class="hero${avatar ? ' has-avatar' : ''}${input.activeSection === 'basic' ? ' is-active' : ''}" data-section-id="basic">${avatar}<div class="identity"><h1 data-editable>${escapeHtml(content.basicInfo.name ?? '姓名')}</h1><p class="role-line" data-editable>${escapeHtml(content.targetRoles.join(' / '))}</p><div class="contact">${contact}</div></div></header>${sections}</main>${input.editable ? editableScript : ''}</body></html>`;
}
