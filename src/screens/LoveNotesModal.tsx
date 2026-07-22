import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { LoveNote } from '../types';
import { sendLoveNote, subscribeToLoveNotes } from '../supabase/gameService';
import { Colors } from '../utils/colors';
import { sendLoveNoteNotification } from '../utils/webNotifications';

// Romantic quick-notes for Partner mode.
const QUICK_NOTES = [
  "You're the best word partner 💌",
  "I love playing with you! 💕",
  "That word was impressive 😍",
  "You're beating me but I still love you 😂",
  "Miss you! Let's play more 🌹",
  "Thinking of you ✨",
  "You have all the right letters 💕",
  "I'd pick you out of any tile bag 🎲",
  "You make my heart double its word score 💖",
  "You're worth way more than 10 points 😘",
  "Triple word score? More like triple heart score 🥰",
  "I'd give you all my vowels 💌",
  "You're the Q to my U 💝",
  "No blanks when it comes to how I feel about you 🫶",
  "You complete my rack 😍",
  "You played your way into my heart 💕",
  "Every move I make is for you 🎯",
];

// Friendly (non-romantic) quick-notes for Friend mode.
const FRIEND_QUICK_NOTES = [
  "Nice word! 👏",
  "Good game! 🎲",
  "Your move! 😄",
  "That was a sneaky play 😏",
  "You're on fire 🔥",
  "Rematch after this? 🤝",
  "How'd you find that word?! 🤯",
  "GG so far 🙌",
  "I'm coming for that lead 👀",
  "Big brain move 🧠",
  "Take your time ⏳",
  "Well played 👌",
  "Lucky tiles! 🍀",
  "You got this 💪",
  "No pressure… 😅",
  "That triple word tho 😤",
  "Let's gooo 🚀",
];

type Props = {
  visible: boolean;
  onClose: () => void;
  gameId: string;
  myUid: string;
  myDisplayName: string;
  partnerUid: string;
  isFriend?: boolean;
};

export default function LoveNotesModal({ visible, onClose, gameId, myUid, myDisplayName, partnerUid, isFriend = false }: Props) {
  const quickNotes = isFriend ? FRIEND_QUICK_NOTES : QUICK_NOTES;
  const [notes, setNotes] = useState<LoveNote[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const prevNoteCountRef = React.useRef(0);

  useEffect(() => {
    if (!visible) return;
    const unsub = subscribeToLoveNotes(gameId, (newNotes) => {
      if (!visible && newNotes.length > prevNoteCountRef.current) {
        const latest = newNotes[0];
        if (latest.toUid === myUid) {
          sendLoveNoteNotification(isFriend ? 'New message 💬' : 'Your partner 💕', latest.message);
        }
      }
      prevNoteCountRef.current = newNotes.length;
      setNotes(newNotes);
    });
    return unsub;
  }, [gameId, visible, myUid, isFriend]);

  async function handleSend(text?: string) {
    const msg = (text ?? message).trim();
    if (!msg) return;
    setSending(true);
    setSendError('');
    try {
      const result = await sendLoveNote(gameId, myUid, partnerUid, msg, isFriend ? '💬' : '💕', myDisplayName);
      if (!result.success) {
        setSendError(result.error ?? 'Could not send — try again');
      } else {
        setMessage('');
      }
    } catch (e: any) {
      setSendError('Could not send — try again');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>{isFriend ? 'Messages 💬' : 'Love Notes 💌'}</Text>
          <TouchableOpacity onPress={onClose} accessibilityLabel={isFriend ? 'Close messages' : 'Close love notes'} accessibilityRole="button">
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Notes feed — flex: 1 so it fills all available space */}
        <FlatList
          data={notes}
          keyExtractor={(n) => n.id}
          style={styles.feed}
          contentContainerStyle={styles.feedContent}
          inverted
          ListEmptyComponent={
            <Text style={styles.empty}>
              {isFriend ? 'No messages yet — send the first one! 💬' : 'No notes yet — send the first one! 💌'}
            </Text>
          }
          renderItem={({ item }) => {
            const isMine = item.fromUid === myUid;
            return (
              <View style={[styles.noteCard, isMine ? styles.noteCardMine : styles.noteCardTheirs]}>
                <Text style={[styles.noteText, isMine && styles.noteTextMine]}>{item.message}</Text>
                <Text style={[styles.noteTime, isMine && styles.noteTimeMine]}>
                  {new Date(item.timestamp).toLocaleDateString()}
                </Text>
              </View>
            );
          }}
        />

        {/* Quick note chips — FlatList handles tap vs scroll better than ScrollView */}
        <FlatList
          horizontal
          data={quickNotes}
          keyExtractor={(item) => item}
          showsHorizontalScrollIndicator={false}
          style={styles.quickScroll}
          contentContainerStyle={styles.quickContent}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.chip}
              onPress={() => handleSend(item)}
              activeOpacity={0.6}
            >
              <Text style={styles.chipText}>{item}</Text>
            </TouchableOpacity>
          )}
        />

        {/* Message input */}
        {sendError ? <Text style={styles.errorText}>{sendError}</Text> : null}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={isFriend ? 'Write a message...' : 'Write a love note...'}
            placeholderTextColor={Colors.textLight}
            value={message}
            onChangeText={setMessage}
            multiline
            returnKeyType="send"
            accessibilityLabel={isFriend ? 'Message' : 'Love note message'}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!message.trim() || sending) && styles.sendBtnDisabled]}
            onPress={() => handleSend()}
            disabled={sending || !message.trim()}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
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
  feed: {
    flex: 1,
  },
  feedContent: {
    padding: 16,
    flexGrow: 1,
  },
  empty: {
    textAlign: 'center',
    color: Colors.textLight,
    fontSize: 14,
    marginTop: 40,
    fontStyle: 'italic',
  },
  noteCard: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 10,
    maxWidth: '80%',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteCardMine: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  noteCardTheirs: {
    alignSelf: 'flex-start',
  },
  noteText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  noteTextMine: { color: '#fff' },
  noteTime: { fontSize: 10, color: Colors.textLight, marginTop: 4, alignSelf: 'flex-end' },
  noteTimeMine: { color: 'rgba(255,255,255,0.85)' },
  quickScroll: {
    flexGrow: 0,
    borderTopWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  quickContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    backgroundColor: Colors.background,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipText: { fontSize: 12, color: Colors.text, whiteSpace: 'nowrap' } as any,
  inputRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderTopWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: 100,
  },
  sendBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: Colors.border,
  },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  errorText: { color: 'red', fontSize: 12, textAlign: 'center', paddingVertical: 4 },
});
