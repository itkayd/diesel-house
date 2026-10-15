// Runs every end-to-end check in a real (headless) Edge. Start `npm run dev` first.
// Multiplayer and voice tests use the real Supabase project, and the TURN test uses Twilio.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = ['auth', 'characters', 'joystick', 'multiplayer', 'movement', 'voice', 'voice-extras', 'audio', 'look', 'doors', 'chat'];
let failed = 0;
for (const f of files) {
  console.log(`\n== ${f}`);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(`./${f}.mjs`, import.meta.url))], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} of ${files.length} test files had failures` : '\nAll test files passed');
process.exitCode = failed ? 1 : 0;
