import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, Alert, KeyboardAvoidingView, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { theme } from '../theme';
import type { ChatMessage } from '../types';

// Live spectator chat for a game, delivered over Supabase Realtime
// (postgres_changes on chat_messages). Posting goes through the post_chat_message
// RPC (validation + rate limit + username snapshot).
export default function ChatPanel({ gameId }: { gameId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [myId, setMyId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage> | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (active) setMyId(u.user?.id ?? null);
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('game_id', gameId)
        .order('created_at', { ascending: true })
        .limit(100);
      if (active && data) setMessages(data as ChatMessage[]);
    })();

    const channel = supabase
      .channel(`chat:${gameId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `game_id=eq.${gameId}` },
        (payload) => {
          const msg = payload.new as ChatMessage;
          setMessages((m) => (m.some((x) => x.id === msg.id) ? m : [...m, msg]));
        }
      )
      .subscribe();

    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [gameId]);

  useEffect(() => {
    if (messages.length) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setText('');
    const { error } = await supabase.rpc('post_chat_message', { p_game_id: gameId, p_body: body });
    if (error) {
      setText(body);
      Alert.alert('Message not sent', error.message.replace(/^[A-Z_]+:\s*/, ''));
    }
    setSending(false);
  }

  return (
    <KeyboardAvoidingView
      style={styles.wrap}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.title}>SPECTATOR CHAT</Text>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        style={styles.list}
        contentContainerStyle={{ paddingVertical: 6 }}
        ListEmptyComponent={<Text style={styles.empty}>No messages yet — say something!</Text>}
        renderItem={({ item }) => (
          <View style={styles.msgRow}>
            <Text style={[styles.msgUser, item.user_id === myId && styles.msgUserMe]}>
              {item.user_id === myId ? 'You' : item.username}:
            </Text>
            <Text style={styles.msgBody}>{item.body}</Text>
          </View>
        )}
      />
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="Message the arena…"
          placeholderTextColor={theme.textMuted}
          value={text}
          onChangeText={setText}
          maxLength={280}
          onSubmitEditing={send}
          returnKeyType="send"
        />
        <Pressable style={styles.sendBtn} onPress={send} disabled={sending}>
          <Text style={styles.sendText}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    marginTop: 14,
  },
  title: { color: theme.gold, fontSize: 11, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  list: { maxHeight: 180 },
  empty: { color: theme.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 12 },
  msgRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 },
  msgUser: { color: theme.emerald, fontWeight: '700', fontSize: 13, marginRight: 6 },
  msgUserMe: { color: theme.gold },
  msgBody: { color: theme.text, fontSize: 13, flexShrink: 1 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  input: {
    flex: 1,
    backgroundColor: theme.surfaceAlt,
    color: theme.text,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sendBtn: { backgroundColor: theme.emerald, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  sendText: { color: theme.bg, fontWeight: '800' },
});
