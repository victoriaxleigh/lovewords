import fs from 'fs';
import path from 'path';

describe('player discovery UI regressions', () => {
  const lobby = fs.readFileSync(path.join(process.cwd(), 'src/screens/LobbyScreen.tsx'), 'utf8');
  const modal = fs.readFileSync(path.join(process.cwd(), 'src/screens/NewGameModal.tsx'), 'utf8');
  const game = fs.readFileSync(path.join(process.cwd(), 'src/screens/GameScreen.tsx'), 'utf8');

  test('bounds pending invitations in their own scrollable region', () => {
    expect(lobby).toContain('<ScrollView');
    expect(lobby).toContain('contentContainerStyle={styles.invitesContent}');
    expect(lobby).toMatch(/invites:\s*\{[^}]*maxHeight:\s*280/);
  });

  test('shows retryable search failures separately from empty results', () => {
    expect(modal).toContain('setSearchError(');
    expect(modal).toContain('Search is unavailable right now.');
    expect(modal).toContain('!searchError && query.trim().length >= 3');
    expect(modal).toContain('accessibilityLabel="Retry player search"');
  });

  test('checks the native paywall before accepting without consuming the invitation', () => {
    expect(lobby).toMatch(
      /if \(action === 'accept'\) \{\s*if \(await isBlockedByPaywall\(\)\) \{[\s\S]*?navigation\.navigate\('Paywall'\);[\s\S]*?return;[\s\S]*?\}\s*await acceptGameInvite/
    );
  });

  test('waits for the nudge endpoint and surfaces its server cooldown', () => {
    expect(game).toContain('const result = await sendNudge(partner.uid, gameId)');
    expect(game).toContain("result === 'cooldown'");
    expect(game).toContain('Already nudged');
    expect(game).toContain('60 * 60 * 1000');
  });
});
