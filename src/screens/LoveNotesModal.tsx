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
} from 'react-native';
import { LoveNote } from '../types';
import { sendLoveNote, subscribeToLoveNotes } from '../supabase/gameService';
import { Colors } from '../utils/colors';
import { sendLoveNoteNotification } from '../utils/webNotifications';

const EMOJIS = ['💕', '💖', '😘', '🌹', '💝', '🥰', '✨', '🫶', '💌', '🎉'];

const QUICK_NOTES = [
  "You're the best word partner 💌",
  "I love playing with you! 💕",
  "That word was impressive 😍",
  "You're beating me but I still love you 😂",
  "Miss you! Let's play more 🌹",
  "Thinking of you ✨",
];

type Props = {
  visible: boolean;
  onClose: () => void;
  gameId: string;
  myUid: string;
  partnerUid: string;
};

export default function LoveNotesModal({ visible, onClose, gameId, myUid, partnerUid }: Props) {
  const [notes, setNotes] = useState<LoveNote[]>([]);
  const [message, setMessage] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('💕');
  const [sending, setSending] = useState(false);

  const prevNoteCountRef = React.useRef(0);

  useEffect(() => {
    if (!visible) return;
    const unsub = subscribeToLoveNotes(gameId, (newNotes) => {
      // Notify if a new note arrived from partner while modal is closed
      if (!visible && newNotes.length > prevNoteCountRef.current) {
        const latest = newNotes[0];
        if (latest.toUid === myUid) {
          sendLoveNoteNotification('Your partner 💕', latest.message);
        }
      }
      prevNoteCountRef.current = newNotes.length;
      setNotes(newNotes);
    });
    return unsub;
  }, [gameId, visible, myUid]);

  async function handleSend(text?: string) {
    const msg = text ?? message.trim();
    if (!msg) return;
    setSending(true);
    try {
      await sendLoveNote(gameId, myUid, partnerUid, msg, selectedEmoji);
      setMessage('');
    } catch {
      Alert.alert('Could not send note');
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Love Notes 💌</Text>
          <TouchableOpacity onPress={onClose}>
            <Text style={styles.close}>Done</Text>
          </TouchableOpacity>
        </View>

        {/* Emoji picker */}
        <View style={styles.emojiRow}>
          {EMOJIS.map((e) => (
            <TouchableOpacity
              key={e}
              onPress={() => setSelectedEmoji(e)}
              style={[styles.emojiBtn, selectedEmoji === e && styles.emojiBtnSelected]}
            >
              <Text style={styles.emoji}>{e}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Quick notes */}
        <View style={styles.quickNotes}>
          {QUICK_NOTES.map((note) => (
            <TouchableOpacity key={note} style={styles.quickNote} onPress={() => handleSend(note)}>
              <Text style={styles.quickNoteText}>{note}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Message input */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="Write a love note..."
            placeholderTextColor={Colors.textLight}
            value={message}
            onChangeText={setMessage}
            multiline
          />
          <TouchableOpacity
            style={styles.sendBtn}
            onPress={() => handleSend()}
            disabled={sending || !message.trim()}
          >
            <Text style={styles.sendBtnText}>Send</Text>
          </TouchableOpacity>
        </View>

        {/* Notes feed */}
        <FlatList
          data={notes}
          keyExtractor={(n) => n.id}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => {
            const isMine = item.fromUid === myUid;
            return (
              <View style={[styles.noteCard, isMine ? styles.noteCardMine : styles.noteCardTheirs]}>
                <Text style={styles.noteEmoji}>{item.emoji}</Text>
                <Text style={[styles.noteText, isMine && styles.noteTextMine]}>{item.message}</Text>
                <Text style={styles.noteTime}>
                  {new Date(item.timestamp).toLocaleDateString()}
                </Text>
              </View>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingTop: 24,
    borderBottomWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  title: { fontSize: 20, fontWeight: '800', color: Colors.primary },
  close: { fontSize: 16, color: Colors.primary, fontWeight: '600' },
  emojiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 12,
    gap: 6,
    backgroundColor: Colors.surface,
  },
  emojiBtn: {
    padding: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  emojiBtnSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.background,
  },
  emoji: { fontSize: 22 },
  quickNotes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    padding: 12,
  },
  quickNote: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  quickNoteText: { fontSize: 12, color: Colors.text },
  inputRow: {
    flexDirection: 'row',
    margin: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 44,
  },
  sendBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    justifyContent: 'center',
  },
  sendBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  noteCard: {
    borderRadius: 16,
    padding: 12,
    marginBottom: 10,
    maxWidth: '80%',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  noteCardMine: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  noteCardTheirs: {
    alignSelf: 'flex-start',
  },
  noteEmoji: { fontSize: 20, marginBottom: 4 },
  noteText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  noteTextMine: { color: '#fff' },
  noteTime: { fontSize: 10, color: 'rgba(0,0,0,0.35)', marginTop: 4, alignSelf: 'flex-end' },
});
