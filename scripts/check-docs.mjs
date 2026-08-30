import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const VALID_STATUSES = new Set(['Draft', 'Ready', 'In Progress', 'Implemented', 'Superseded']);
const SPEC_DIRECTORY = /^\d{3}-[a-z0-9-]+$/;

async function markdownFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return markdownFiles(target);
      return entry.isFile() && entry.name.endsWith('.md') ? [target] : [];
    }),
  );
  return nested.flat();
}

function relative(root, target) {
  return path.relative(root, target).replaceAll('\\', '/');
}

function declarations(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

export async function checkDocs(rootDirectory) {
  const root = path.resolve(rootDirectory);
  const specsRoot = path.join(root, 'specs');
  const specEntries = await readdir(specsRoot, { withFileTypes: true });
  const specDirectories = specEntries
    .filter((entry) => entry.isDirectory() && SPEC_DIRECTORY.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const errors = [];
  const requirementOwners = new Map();
  const taskOwners = new Map();
  const requiredFiles = ['spec.md', 'design.md', 'tasks.md'];

  for (const directory of specDirectories) {
    const texts = new Map();
    for (const fileName of requiredFiles) {
      const file = path.join(specsRoot, directory, fileName);
      if (!existsSync(file)) {
        errors.push(`Missing specification file: specs/${directory}/${fileName}`);
        continue;
      }
      const text = await readFile(file, 'utf8');
      texts.set(fileName, text);
      const status = text.match(/^> 状态：(.+)$/m)?.[1]?.trim();
      if (!status || !VALID_STATUSES.has(status)) {
        errors.push(`Invalid or missing status: specs/${directory}/${fileName}`);
      }
    }

    const spec = texts.get('spec.md');
    const tasks = texts.get('tasks.md');
    if (!spec || !tasks) continue;

    if (spec.match(/^> 状态：(.+)$/m)?.[1]?.trim() === 'Ready') {
      const unresolved = spec
        .match(/^## 未解决问题\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m)?.[1]
        ?.trim();
      if (!(unresolved === '无' || unresolved?.startsWith('无。'))) {
        errors.push(`Ready specification has unresolved questions: specs/${directory}/spec.md`);
      }
    }

    const requirements = declarations(spec, /^- \*\*([A-Z][A-Z0-9]*-(?:Q\d{2}|\d{3}))\*\*：/gm);
    const taskIds = declarations(tasks, /^- \[[ xX]\] \*\*([A-Z][A-Z0-9]*-T\d{3})\*\*/gm);

    for (const id of requirements) {
      const previous = requirementOwners.get(id);
      if (previous) errors.push(`Duplicate requirement ID ${id}: ${previous}, ${directory}`);
      else requirementOwners.set(id, directory);
      if (!tasks.includes(id))
        errors.push(`Requirement ${id} is not covered by ${directory}/tasks.md`);
    }
    for (const id of taskIds) {
      const previous = taskOwners.get(id);
      if (previous) errors.push(`Duplicate task ID ${id}: ${previous}, ${directory}`);
      else taskOwners.set(id, directory);
    }
  }

  const index = await readFile(path.join(specsRoot, 'README.md'), 'utf8');
  const indexed = new Set(declarations(index, /^\|\s*`(\d{3}-[a-z0-9-]+)`\s*\|/gm));
  for (const directory of specDirectories) {
    if (!indexed.has(directory)) errors.push(`Specification index is missing ${directory}`);
  }
  for (const directory of indexed) {
    if (!specDirectories.includes(directory))
      errors.push(`Specification index has unknown ${directory}`);
  }

  const files = [
    path.join(root, 'AGENTS.md'),
    ...(await markdownFiles(path.join(root, 'docs'))),
    ...(await markdownFiles(specsRoot)),
  ];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, indexOfLine) => {
      if (/\s+$/.test(line))
        errors.push(`Trailing whitespace: ${relative(root, file)}:${indexOfLine + 1}`);
    });
    if ((text.match(/^```/gm)?.length ?? 0) % 2 !== 0) {
      errors.push(`Unbalanced code fences: ${relative(root, file)}`);
    }

    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      let target = match[1].trim();
      if (/^(#|https?:\/\/|mailto:)/.test(target)) continue;
      target = target.split('#')[0]?.trim() ?? '';
      if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
      try {
        target = decodeURIComponent(target);
      } catch {
        errors.push(`Invalid link encoding in ${relative(root, file)}: ${match[1]}`);
        continue;
      }
      if (target && !existsSync(path.resolve(path.dirname(file), target))) {
        errors.push(`Broken link in ${relative(root, file)}: ${match[1]}`);
      }
    }
  }

  return {
    errors,
    markdownFileCount: files.length,
    requirementCount: requirementOwners.size,
    specCount: specDirectories.length,
    taskCount: taskOwners.size,
  };
}

async function main() {
  const result = await checkDocs(path.resolve(import.meta.dirname, '..'));
  if (result.errors.length > 0) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
    return;
  }
  console.log(
    `Documentation valid: ${result.specCount} specs, ${result.requirementCount} requirements, ${result.taskCount} tasks, ${result.markdownFileCount} Markdown files.`,
  );
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
