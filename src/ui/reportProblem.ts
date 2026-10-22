import { crumb, logIssue } from '../net/errors';
import { icon } from './icons';
import { el } from './modal';
import { addSettingsSection, sectionLabel } from './settings';

// "Report a problem" in Settings → More: say what went wrong in your own words; it goes to the admin page
// with the phone's details and the last few things that happened in the game (src/net/errors.ts).
let added = false;
export function addReportProblem() {
  if (added) return;
  added = true;
  addSettingsSection(
    90,
    (box) => {
      const text = el('textarea', 'dh-input dh-report-text');
      text.id = 'report-text';
      text.maxLength = 600;
      text.rows = 3;
      text.placeholder = 'What happened? e.g. "The joystick kept walking left after I walked into the Gaming room."';
      const send = el('button', 'dh-btn dh-btn--quiet');
      send.type = 'button';
      send.id = 'report-send';
      send.append(icon('send'), document.createTextNode('Send to Diesel'));
      const status = el('p', 'v2-note', 'Your phone’s details and the last few things that happened in the game go with it, so it can be fixed. Nothing private.');
      status.id = 'report-status';
      send.addEventListener('click', () => {
        const words = text.value.trim();
        if (words.length < 4) {
          status.textContent = 'Write a few words about what went wrong first.';
          text.focus();
          return;
        }
        crumb('reported a problem');
        logIssue('report', words, { force: true });
        text.value = '';
        send.disabled = true;
        status.textContent = 'Sent. Thank you!';
        setTimeout(() => (send.disabled = false), 20_000);
      });
      box.append(sectionLabel('Report a problem', 'report-text'), text, send, status);
    },
    true,
    'more',
  );
}
