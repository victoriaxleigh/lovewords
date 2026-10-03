// Runs the real unread-note service against the ?dev=1 in-memory client.
jest.mock('../src/supabase/config', () => ({
  supabase: require('../src/supabase/mockClient').mockSupabase,
}));

import {
  markGameNotesRead,
  sendLoveNote,
  subscribeToUnreadNoteCounts,
} from '../src/supabase/gameService';

const DEV = '00000000-0000-0000-0000-000000000001';
const CASEY = '00000000-0000-0000-0000-000000000004';
const CASEY_GAME = '00000000-0000-0000-0000-000000000011';

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('seeded note from Casey shows, clears live on mark-read, and my own notes never count', async () => {
  const devCounts = jest.fn();
  const caseyCounts = jest.fn();
  const stopDev = subscribeToUnreadNoteCounts(DEV, devCounts);
  const stopCasey = subscribeToUnreadNoteCounts(CASEY, caseyCounts);
  await flush();

  // Dev sees only Casey's note; Dev's own unread note to Casey counts for Casey.
  expect(devCounts).toHaveBeenLastCalledWith({ [CASEY_GAME]: 1 });
  expect(caseyCounts).toHaveBeenLastCalledWith({ [CASEY_GAME]: 1 });

  // Opening the notes modal marks it read; the dot clears without a reload.
  await markGameNotesRead(CASEY_GAME, DEV);
  await flush();
  expect(devCounts).toHaveBeenLastCalledWith({});
  // Marking my notes read leaves the partner's unread notes alone.
  expect(caseyCounts).toHaveBeenLastCalledWith({ [CASEY_GAME]: 1 });

  // A new note from Casey brings the dot back live.
  await sendLoveNote(CASEY_GAME, CASEY, DEV, 'Your move 💕', '💕');
  await flush();
  expect(devCounts).toHaveBeenLastCalledWith({ [CASEY_GAME]: 1 });

  // A note I send never produces a dot for me.
  await sendLoveNote(CASEY_GAME, DEV, CASEY, 'Coming!', '💕');
  await flush();
  expect(devCounts).toHaveBeenLastCalledWith({ [CASEY_GAME]: 1 });
  expect(caseyCounts).toHaveBeenLastCalledWith({ [CASEY_GAME]: 2 });

  stopDev();
  stopCasey();
});
