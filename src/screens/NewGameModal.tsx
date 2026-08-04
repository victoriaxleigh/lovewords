import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Share,
  Linking,
} from 'react-native';
import { GameMode } from '../types';
import { Colors } from '../utils/colors';
import { RADII, SHADOWS } from '../utils/styles';
import { PublicProfile, searchProfiles } from '../supabase/authService';
import { formatInviteCode } from '../utils/invites';

export type PendingInvite = {
  code: string;
  link: string;
  channel: 'email' | 'phone';
  contact: string; // the email address or phone number the invite is for
  emailed: boolean; // whether the app auto-emailed it (always false for phone)
};

type Step = 'menu' | 'invite' | 'find';

type Props = {
  visible: boolean;
  onClose: () => void;
  onStart: (email: string, mode: GameMode) => void;
  onStartPhone: (phone: string, mode: GameMode) => void;
  onInvite: (profile: PublicProfile, mode: GameMode) => void;
  onStartSolo: () => void;
  inviting: boolean;
  startingSolo: boolean;
  errorMsg: string | null;
  onClearError: () => void;
  pendingInvite: PendingInvite | null;
  onDismissInvite: () => void;
};

export default function NewGameModal({
  visible,
  onClose,
  onStart,
  onStartPhone,
  onInvite,
  onStartSolo,
  inviting,
  startingSolo,
  errorMsg,
  onClearError,
  pendingInvite,
  onDismissInvite,
}: Props) {
  const [mode, setMode] = useState<GameMode>('partner');
  const [step, setStep] = useState<Step>('menu');
  const [contact, setContact] = useState('');
  const [contactError, setContactError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PublicProfile[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [copied, setCopied] = useState(false);

  const busy = inviting || startingSolo;

  useEffect(() => {
    setCopied(false);
  }, [pendingInvite?.code]);

  function inviteMessage(invite: PendingInvite) {
    return (
      `Play LoveWords with me 💌\n${invite.link}\n` +
      `Or enter code ${formatInviteCode(invite.code)} in the app.`
    );
  }

  // Open the user's email app with the invite pre-addressed and pre-written, so
  // they send it from their own account (no email provider / domain needed).
  async function handleEmailInvite() {
    if (!pendingInvite) return;
    const subject = 'Play LoveWords with me 💌';
    const body = inviteMessage(pendingInvite);
    const url =
      `mailto:${encodeURIComponent(pendingInvite.contact)}` +
      `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.location.href = url;
      return;
    }
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Fall through to the share sheet.
    }
    await handleShareInvite();
  }

  // Open the SMS composer prefilled with the recipient and the invite message.
  // Cross-platform sms: URIs differ (iOS uses & before body, Android uses ?),
  // and desktop has no composer, so fall back to the generic share/copy path.
  async function handleTextInvite() {
    if (!pendingInvite) return;
    const message = inviteMessage(pendingInvite);
    const number = pendingInvite.contact.replace(/[^0-9+]/g, '');
    if (Platform.OS === 'web') {
      await handleShareInvite();
      return;
    }
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const url = `sms:${number}${separator}body=${encodeURIComponent(message)}`;
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {
      // Fall through to the share sheet.
    }
    await handleShareInvite();
  }

  async function handleShareInvite() {
    if (!pendingInvite) return;
    const message = inviteMessage(pendingInvite);
    if (Platform.OS === 'web') {
      try {
        const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
        if (nav?.share) {
          await nav.share({ title: 'LoveWords invite', text: message, url: pendingInvite.link });
          return;
        }
        await handleCopyLink();
      } catch {
        // User dismissed the share sheet — nothing to do.
      }
      return;
    }
    try {
      await Share.share({ message });
    } catch {
      // Share cancelled.
    }
  }

  async function handleCopyLink() {
    if (!pendingInvite) return;
    try {
      const nav: any = typeof navigator !== 'undefined' ? navigator : undefined;
      if (Platform.OS === 'web' && nav?.clipboard?.writeText) {
        await nav.clipboard.writeText(pendingInvite.link);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        return;
      }
      await Share.share({ message: pendingInvite.link });
    } catch {
      // Copy/share failed or was cancelled — the link is still visible to read.
    }
  }

  function resetContactFields() {
    setContact('');
    setContactError(null);
    setQuery('');
    setResults([]);
    setSearchError(null);
    setStep('menu');
  }

  // ‹ back — return to the menu with the current step's inputs cleared.
  function goToMenu() {
    resetContactFields();
    onClearError();
  }

  function handleDoneInvite() {
    onDismissInvite();
    resetContactFields();
    onClose();
  }

  // "Invite someone else" from the ready panel: clear the last contact and drop
  // back onto a fresh Invite step.
  function handleInviteAnother() {
    onDismissInvite();
    setContact('');
    setContactError(null);
    setStep('invite');
  }

  // One field, either channel: route an email to onStart (start with an existing
  // member, or mint an email invite) and a phone number to onStartPhone.
  function handleContactSubmit() {
    const value = contact.trim();
    if (!value || busy) return;
    if (value.includes('@')) {
      setContactError(null);
      onStart(value, mode);
      return;
    }
    if (value.replace(/\D/g, '').length >= 7) {
      setContactError(null);
      onStartPhone(value, mode);
      return;
    }
    setContactError('Enter an email address or a phone number.');
  }

  useEffect(() => {
    const trimmed = query.trim();
    if (!visible || step !== 'find' || trimmed.length < 3) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    setResults([]);
    const timer = setTimeout(() => {
      searchProfiles(trimmed)
        .then((profiles) => {
          if (!cancelled) setResults(profiles);
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setSearchError('Search is unavailable right now. Check your connection and try again.');
          }
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, step, visible, searchAttempt]);

  function handleClose() {
    if (busy) return;
    resetContactFields();
    setSearchError(null);
    onClearError();
    onClose();
  }

  const inSubStep = !pendingInvite && step !== 'menu';
  const stepTitle = step === 'invite' ? 'Invite' : 'Find a player';

  // Partner/Friend chooser — shown on the Invite and Find steps, where it applies.
  const modeToggle = (
    <>
      <Text style={styles.label}>Who are you playing with?</Text>
      <View style={styles.modeRow}>
        <TouchableOpacity
          style={[styles.modePill, mode === 'partner' && styles.modePillActive]}
          onPress={() => setMode('partner')}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'partner' }}
          accessibilityLabel="Partner mode — love letters, sweet nothings between moves"
        >
          <Text style={[styles.modePillText, mode === 'partner' && styles.modePillTextActive]}>💕 Partner</Text>
          <Text style={[styles.modeSub, mode === 'partner' && styles.modeSubActive]}>&ldquo;Love letters&rdquo;</Text>
          <Text style={[styles.modeGloss, mode === 'partner' && styles.modeGlossActive]}>sweet nothings between moves</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.modePill, mode === 'friend' && styles.modePillActive]}
          onPress={() => setMode('friend')}
          accessibilityRole="button"
          accessibilityState={{ selected: mode === 'friend' }}
          accessibilityLabel="Friend mode — fighting words, friendly trash talk between moves"
        >
          <Text style={[styles.modePillText, mode === 'friend' && styles.modePillTextActive]}>🎲 Friend</Text>
          <Text style={[styles.modeSub, mode === 'friend' && styles.modeSubActive]}>&ldquo;Fighting words&rdquo;</Text>
          <Text style={[styles.modeGloss, mode === 'friend' && styles.modeGlossActive]}>friendly trash talk between moves</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          {inSubStep ? (
            <TouchableOpacity
              onPress={goToMenu}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Back to menu"
            >
              <Text style={styles.backLead}>‹  {stepTitle}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.title}>New Game 💌</Text>
          )}
          <TouchableOpacity onPress={handleClose} accessibilityLabel="Close new game" accessibilityRole="button">
            <Text style={styles.close}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {pendingInvite ? (
            <View style={styles.invitePanel}>
              <Text style={styles.inviteHeadline}>Invite ready 💌</Text>
              <Text style={styles.invitePanelSub}>
                {pendingInvite.channel === 'phone'
                  ? `Text this to ${pendingInvite.contact} so they can join you:`
                  : pendingInvite.emailed
                  ? `We emailed an invite to ${pendingInvite.contact}. Want to reach them faster? Send this too:`
                  : `Share this with ${pendingInvite.contact} so they can join you:`}
              </Text>

              <View style={styles.inviteCodeBox}>
                <Text style={styles.inviteCodeLabel}>Invite code</Text>
                <Text style={styles.inviteCodeValue} accessibilityLabel={`Invite code ${formatInviteCode(pendingInvite.code)}`}>
                  {formatInviteCode(pendingInvite.code)}
                </Text>
              </View>

              <Text style={styles.inviteLink} numberOfLines={2}>{pendingInvite.link}</Text>

              {pendingInvite.channel === 'phone' ? (
                <TouchableOpacity
                  style={styles.startBtn}
                  onPress={handleTextInvite}
                  accessibilityRole="button"
                  accessibilityLabel="Text invite"
                >
                  <Text style={styles.startBtnText}>💬 Text invite</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.startBtn}
                  onPress={handleEmailInvite}
                  accessibilityRole="button"
                  accessibilityLabel="Email invite"
                >
                  <Text style={styles.startBtnText}>📧 Email invite</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.inviteSecondaryBtn}
                onPress={handleCopyLink}
                accessibilityRole="button"
                accessibilityLabel="Copy invite link"
              >
                <Text style={styles.inviteSecondaryText}>{copied ? 'Copied!' : 'Copy link'}</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleInviteAnother} disabled={busy}>
                <Text style={styles.fallbackLink}>Invite someone else</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleDoneInvite}>
                <Text style={styles.inviteDoneLink}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : step === 'menu' ? (
            <>
              <Text style={styles.menuIntro}>How do you want to start?</Text>

              <TouchableOpacity
                style={styles.menuRow}
                onPress={() => setStep('find')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Find a player by name"
              >
                <View style={styles.menuIcon}><Text style={styles.menuEmoji}>🔍</Text></View>
                <View style={styles.menuText}>
                  <Text style={styles.menuTitle}>Find a player by name</Text>
                  <Text style={styles.menuSub}>Search players who have made themselves discoverable</Text>
                </View>
                <Text style={styles.menuChev}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuRow}
                onPress={() => setStep('invite')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Invite by email or phone"
              >
                <View style={styles.menuIcon}><Text style={styles.menuEmoji}>💌</Text></View>
                <View style={styles.menuText}>
                  <Text style={styles.menuTitle}>Invite by email or phone</Text>
                  <Text style={styles.menuSub}>Start a game with anyone by sending a message</Text>
                </View>
                <Text style={styles.menuChev}>›</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.menuRow, styles.menuRowSolo]}
                onPress={onStartSolo}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel="Practice solo"
              >
                <View style={styles.menuIconSolo}><Text style={styles.menuEmoji}>🎯</Text></View>
                <View style={styles.menuText}>
                  <Text style={styles.menuTitle}>Practice solo</Text>
                  <Text style={styles.menuSub}>Play both sides yourself</Text>
                </View>
                {startingSolo ? (
                  <ActivityIndicator color={Colors.primary} size="small" />
                ) : (
                  <Text style={styles.menuChev}>›</Text>
                )}
              </TouchableOpacity>

              {errorMsg ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{errorMsg}</Text>
                </View>
              ) : null}
            </>
          ) : step === 'invite' ? (
            <>
              {modeToggle}
              <Text style={[styles.label, { marginTop: 20 }]}>Their email or phone</Text>
              <Text style={styles.emailHint}>
                We'll start the game if they're already on LoveWords, or send them an invite to join if not.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Email address or phone number"
                placeholderTextColor={Colors.textLight}
                value={contact}
                onChangeText={(text) => {
                  setContact(text);
                  if (contactError) setContactError(null);
                  if (errorMsg) onClearError();
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Their email address or phone number"
              />
              {contactError && <Text style={styles.contactError}>{contactError}</Text>}
              <TouchableOpacity
                style={[styles.startBtn, (!contact.trim() || busy) && styles.startBtnDisabled]}
                onPress={handleContactSubmit}
                disabled={!contact.trim() || busy}
                accessibilityRole="button"
              >
                {inviting ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.startBtnText}>Continue</Text>
                )}
              </TouchableOpacity>

              {errorMsg ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{errorMsg}</Text>
                </View>
              ) : null}
            </>
          ) : (
            <>
              {modeToggle}
              <Text style={[styles.label, { marginTop: 20 }]}>Search by display name</Text>
              <Text style={styles.searchNote}>
                Only players who turn on “Discoverable” in their own Settings show up here — to reach
                anyone else, go back and invite them by email or phone.
              </Text>
              <TextInput
                style={styles.input}
                placeholder="Type at least 3 characters"
                placeholderTextColor={Colors.textLight}
                value={query}
                onChangeText={(text) => {
                  setQuery(text);
                  if (errorMsg) onClearError();
                }}
                autoCapitalize="words"
                autoCorrect={false}
                accessibilityLabel="Search players by display name"
              />
              {searching && <ActivityIndicator color={Colors.primary} style={styles.searchSpinner} />}
              {!searching && !searchError && query.trim().length >= 3 && results.length === 0 && (
                <Text style={styles.searchHint}>
                  No discoverable players match — they may not have turned on Discoverable. Go back and
                  invite them by email or phone instead.
                </Text>
              )}
              {searchError && (
                <View style={styles.searchError}>
                  <Text style={styles.searchErrorText}>{searchError}</Text>
                  <TouchableOpacity
                    onPress={() => setSearchAttempt((attempt) => attempt + 1)}
                    accessibilityRole="button"
                    accessibilityLabel="Retry player search"
                  >
                    <Text style={styles.retryText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
              {results.map((profile) => (
                <TouchableOpacity
                  key={profile.profileId}
                  style={styles.result}
                  onPress={() => onInvite(profile, mode)}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Invite ${profile.displayName}, player code ${profile.playerCode}`}
                >
                  <View>
                    <Text style={styles.resultName}>{profile.displayName}</Text>
                    <Text style={styles.resultCode}>Player #{profile.playerCode}</Text>
                  </View>
                  <Text style={styles.resultAction}>Invite</Text>
                </TouchableOpacity>
              ))}

              {errorMsg ? (
                <View style={styles.errorBanner}>
                  <Text style={styles.errorBannerText}>{errorMsg}</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 24,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  title: { fontSize: 20, fontWeight: '800', color: Colors.primaryDark },
  close: { fontSize: 16, color: Colors.primaryDark, fontWeight: '600' },
  backLead: { fontSize: 18, color: Colors.primaryDark, fontWeight: '700' },
  body: { padding: 20 },
  // ── New Game menu ──
  menuIntro: { fontSize: 14, color: Colors.textLight, fontWeight: '600', marginBottom: 14 },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 15,
    paddingHorizontal: 15,
    marginBottom: 12,
    ...SHADOWS.card,
  },
  menuRowSolo: {
    backgroundColor: 'transparent',
    borderStyle: 'dashed',
    borderColor: Colors.primary,
    shadowOpacity: 0,
    elevation: 0,
  },
  menuIcon: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: Colors.tilePlaced,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuIconSolo: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: Colors.tilePlaced,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuEmoji: { fontSize: 21 },
  menuText: { flex: 1 },
  menuTitle: { fontSize: 15.5, fontWeight: '800', color: Colors.text },
  menuSub: { fontSize: 12, color: Colors.textLight, marginTop: 2, lineHeight: 16 },
  menuChev: { fontSize: 24, fontWeight: '700', color: Colors.primary },
  label: { fontSize: 14, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  modeRow: { flexDirection: 'row', gap: 12 },
  modePill: {
    flex: 1,
    borderRadius: RADII.lg,
    paddingVertical: 16,
    paddingHorizontal: 12,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modePillActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.tilePlaced,
  },
  modePillText: { fontSize: 16, fontWeight: '800', color: Colors.textLight },
  modePillTextActive: { color: Colors.primaryDark },
  modeSub: { fontSize: 11, fontWeight: '700', fontStyle: 'italic', color: Colors.textLight, marginTop: 4, textAlign: 'center' },
  modeSubActive: { color: Colors.primaryDark },
  modeGloss: { fontSize: 10, color: Colors.textLight, marginTop: 2, textAlign: 'center' },
  modeGlossActive: { color: Colors.primaryDark },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: RADII.md,
    padding: 14,
    fontSize: 15,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  errorBanner: {
    backgroundColor: '#FFF0F0',
    borderRadius: 10,
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#FFB3B3',
  },
  errorBannerText: { fontSize: 13, color: Colors.errorDark, fontWeight: '600' },
  startBtn: {
    backgroundColor: Colors.primary,
    borderRadius: RADII.md,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 18,
  },
  startBtnDisabled: { backgroundColor: Colors.border },
  startBtnText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  emailHint: { color: Colors.textLight, fontSize: 12, marginBottom: 10, marginTop: -2, lineHeight: 17 },
  contactError: { color: Colors.errorDark, fontSize: 13, fontWeight: '600', marginTop: 8 },
  searchToggle: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 22,
    marginBottom: 4,
  },
  searchNote: { color: Colors.textLight, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  invitePanel: { alignItems: 'stretch' },
  inviteHeadline: { fontSize: 20, fontWeight: '800', color: Colors.primaryDark, textAlign: 'center' },
  invitePanelSub: {
    fontSize: 14,
    color: Colors.text,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 18,
    lineHeight: 20,
  },
  inviteCodeBox: {
    backgroundColor: Colors.tilePlaced,
    borderRadius: RADII.lg,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  inviteCodeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.primaryDark,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  inviteCodeValue: {
    fontSize: 30,
    fontWeight: '900',
    color: Colors.primaryDark,
    letterSpacing: 3,
    marginTop: 4,
  },
  inviteLink: {
    fontSize: 13,
    color: Colors.textLight,
    textAlign: 'center',
    marginBottom: 16,
  },
  inviteSecondaryBtn: {
    borderRadius: RADII.md,
    paddingVertical: 13,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    marginTop: 10,
  },
  inviteSecondaryText: { color: Colors.primaryDark, fontSize: 15, fontWeight: '800' },
  inviteDoneLink: {
    color: Colors.textLight,
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 18,
  },
  searchSpinner: { marginTop: 14 },
  searchHint: { color: Colors.textLight, fontSize: 13, marginTop: 12, textAlign: 'center' },
  searchError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFF0F0',
    borderRadius: RADII.md,
    padding: 10,
    marginTop: 12,
  },
  searchErrorText: { flex: 1, color: Colors.errorDark, fontSize: 13 },
  retryText: { color: Colors.primaryDark, fontSize: 13, fontWeight: '800' },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    padding: 12,
    borderRadius: RADII.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  resultName: { color: Colors.text, fontSize: 15, fontWeight: '800' },
  resultCode: { color: Colors.textLight, fontSize: 12, marginTop: 2 },
  resultAction: { color: Colors.primaryDark, fontSize: 14, fontWeight: '800' },
  fallbackLink: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 14,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 20,
    gap: 12,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  dividerText: { color: Colors.textLight, fontSize: 13 },
  soloBtn: {
    borderRadius: RADII.md,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderStyle: 'dashed',
  },
  soloBtnText: { color: Colors.primaryDark, fontSize: 15, fontWeight: '700' },
});
