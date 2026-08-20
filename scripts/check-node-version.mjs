const supportedMajor = 24;
const currentMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);

if (currentMajor !== supportedMajor) {
  console.error(
    `JobHunter requires Node.js ${supportedMajor} LTS; current runtime is ${process.versions.node}.`,
  );
  process.exit(1);
}
