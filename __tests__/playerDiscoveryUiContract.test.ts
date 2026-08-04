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

  test('leads with one email-or-phone action and demotes name search', () => {
    // Primary path: a single field that routes to email or phone by content.
    expect(modal).toContain('Invite by email or phone');
    expect(modal).toContain('function handleContactSubmit');
    expect(modal).toContain('onStart(value, mode)');
    expect(modal).toContain('onStartPhone(value, mode)');
    // Name search is now a secondary, collapsible option that explains the
    // discoverability requirement instead of dead-ending.
    expect(modal).toContain('Find a player by name');
    expect(modal).toContain('Discoverable');
    expect(modal).toMatch(/invite them\s+by email or phone instead/i);
  });

  test('opens to a menu that branches into focused steps', () => {
    expect(modal).toContain("useState<Step>('menu')");
    expect(modal).toContain("setStep('find')");
    expect(modal).toContain("setStep('invite')");
    // Solo starts straight from the menu; the other two branch to their own step.
    expect(modal).toContain('Practice solo');
    expect(modal).toContain('Back to menu');
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
