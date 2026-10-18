// Runs every end-to-end check in a real (headless) Edge. Start `npm run dev` first.
// Most tests use dev test mode (their own house). The ones that sign in as the test members
// (DH_TEST_OWNER / DH_TEST_VISITOR) go into the REAL house, so they only run when nobody is there:
// this checks first (scripts/peek-house.mjs, which never appears in the house) and skips them otherwise.
// The TURN test uses Twilio.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = ['auth', 'characters', 'joystick', 'multiplayer', 'movement', 'voice', 'voice-extras', 'audio', 'look', 'doors', 'chat', 'guests', 'presence-limits', 'mic-help', 'profile', 'mic-state', 'zoom', 'touch-guards', 'indicators', 'resume', 'mic-button', 'sound-settings', 'sounds', 'assets', 'hallway', 'update', 'emotes', 'games', 'table-games-local', 'table-games', 'whos-where', 'voice-volume', 'progress', 'critters', 'resilience', 'dnd', 'house', 'guide', 'ui-extras'];

const env = { ...process.env };
if (env.DH_TEST_OWNER) {
  const peek = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(new URL('../../scripts/peek-house.mjs', import.meta.url))], { env, encoding: 'utf8' });
  const said = (peek.stdout || peek.stderr || '').trim();
  console.log(`House check: ${said}`);
  if (peek.status !== 0) {
    console.log('Someone is in the house (or the check failed): skipping the tests that sign in for real.');
    delete env.DH_TEST_OWNER;
    delete env.DH_TEST_VISITOR;
  }
}

let failed = 0;
for (const f of files) {
  console.log(`\n== ${f}`);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(`./${f}.mjs`, import.meta.url))], { stdio: 'inherit', env });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} of ${files.length} test files had failures` : '\nAll test files passed');
process.exitCode = failed ? 1 : 0;
