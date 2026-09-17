/**
 * Prepares a release. Turns the notes in changes/ into a CHANGELOG section for
 * the new version, sets that version in package.json, and stops there: nothing
 * is committed, tagged or pushed, so the result can be read before it's history.
 *
 *   npx tsx scripts/release.ts 0.1.1              prepare the release
 *   npx tsx scripts/release.ts 0.1.1 --dry-run    print the section, change nothing
 *   npx tsx scripts/release.ts --check            check the notes in changes/ (CI runs this)
 *
 * One note per change, one file each, so two pull requests never touch the same
 * line: changes/<section>-<what-it-is>.md, holding the bullets as they should
 * read in the changelog.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Keep a Changelog's sections, in the order it lists them. */
const SECTIONS = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'] as const;
type Section = (typeof SECTIONS)[number];

const CHANGES_DIR = 'changes';
const CHANGELOG = 'CHANGELOG.md';
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

interface Note {
  file: string;
  section: Section;
  bullets: string;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/** Every note in changes/, with where it belongs and what it says. Throws on anything malformed. */
function readNotes(): Note[] {
  if (!existsSync(CHANGES_DIR)) return [];
  const notes: Note[] = [];
  for (const file of readdirSync(CHANGES_DIR).sort()) {
    if (file === 'README.md' || file.startsWith('.')) continue;
    if (!file.endsWith('.md')) fail(`${join(CHANGES_DIR, file)}: notes are .md files`);
    const prefix = file.split('-')[0]!.toLowerCase();
    const section = SECTIONS.find((s) => s.toLowerCase() === prefix);
    if (!section) {
      fail(`${join(CHANGES_DIR, file)}: name it <section>-<what-it-is>.md, where section is one of ${SECTIONS.join(', ').toLowerCase()}`);
    }
    const bullets = readFileSync(join(CHANGES_DIR, file), 'utf8').trim();
    if (!bullets.startsWith('- ')) fail(`${join(CHANGES_DIR, file)}: write the note as changelog bullets, starting with "- "`);
    notes.push({ file, section, bullets });
  }
  return notes;
}

/** The notes as a changelog section, sections in Keep a Changelog order. */
function section(version: string, notes: Note[], today: string): string {
  const parts = [`## [${version}] - ${today}`];
  for (const name of SECTIONS) {
    const mine = notes.filter((n) => n.section === name);
    if (mine.length) parts.push(`### ${name}`, mine.map((n) => n.bullets).join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

function check(): void {
  const notes = readNotes();
  console.log(notes.length ? `${notes.length} note(s) in ${CHANGES_DIR}/, all readable.` : `No notes in ${CHANGES_DIR}/ yet.`);
}

function prepare(version: string, dryRun: boolean): void {
  if (!VERSION.test(version)) fail(`"${version}" isn't a version like 0.1.1 or 0.2.0-beta.1`);
  const changelog = readFileSync(CHANGELOG, 'utf8');
  if (changelog.includes(`## [${version}]`)) fail(`${CHANGELOG} already has a section for ${version}`);

  const notes = readNotes();
  if (!notes.length) fail(`nothing to release: ${CHANGES_DIR}/ has no notes`);

  // Above the newest version already in the file.
  const at = changelog.search(/^## \[/m);
  if (at < 0) fail(`${CHANGELOG} has no "## [version]" section to add to`);
  const text = section(version, notes, new Date().toISOString().slice(0, 10));

  if (dryRun) {
    console.log(text);
    console.log(`(dry run: ${CHANGELOG}, package.json and ${CHANGES_DIR}/ are untouched)`);
    return;
  }

  writeFileSync(CHANGELOG, `${changelog.slice(0, at)}${text}\n${changelog.slice(at)}`);
  for (const note of notes) rmSync(join(CHANGES_DIR, note.file));
  // Also updates package-lock.json, and never commits or tags.
  execFileSync('npm', ['version', version, '--no-git-tag-version', '--allow-same-version'], { stdio: 'pipe' });

  console.log(`Prepared ${version}: ${notes.length} note(s) into ${CHANGELOG}, version set, notes removed.`);
  console.log('\nRead the changes, then:');
  console.log(`  git add -A && git commit -m "Release ${version}"`);
  console.log(`  git push origin main`);
  console.log(`  git tag v${version} && git push origin v${version}`);
  console.log('\nThe tag builds the installers into a draft release. Nothing is public until you publish it.');
}

const args = process.argv.slice(2);
if (args.includes('--check')) check();
else if (!args[0] || args[0].startsWith('-')) fail('give the version to prepare, e.g. 0.1.1 (or --check)');
else prepare(args[0], args.includes('--dry-run'));
