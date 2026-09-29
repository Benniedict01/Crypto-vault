import React, { useEffect, useState, useCallback } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  FlatList,
  StyleSheet,
  TextInput,
  Button,
  RefreshControl,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerForPushNotificationsAsync } from './src/notifications';
import { fetchBalances, registerPushToken } from './src/api';

const SERVER_URL_KEY = 'crypto-vault:server-url';
const ACCESS_TOKEN_KEY = 'crypto-vault:access-token';

export default function App() {
  const [serverUrl, setServerUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [entries, setEntries] = useState([]);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [screen, setScreen] = useState('dashboard'); // 'dashboard' | 'settings'

  // Load the saved server address (and token, if this is a public
  // deployment) on first launch. If there isn't one yet, open
  // straight to settings so there's something to see.
  useEffect(() => {
    Promise.all([AsyncStorage.getItem(SERVER_URL_KEY), AsyncStorage.getItem(ACCESS_TOKEN_KEY)]).then(
      ([savedUrl, savedToken]) => {
        if (savedUrl) {
          setServerUrl(savedUrl);
          setUrlInput(savedUrl);
        } else {
          setScreen('settings');
        }
        if (savedToken) {
          setAccessToken(savedToken);
          setTokenInput(savedToken);
        }
      }
    );
  }, []);

  // Ask for notification permission and hand the resulting token to
  // your own server - never to Claude, Expo's team, or anyone else.
  useEffect(() => {
    registerForPushNotificationsAsync()
      .then((pushToken) => {
        if (serverUrl) registerPushToken(serverUrl, pushToken, accessToken).catch(() => {});
      })
      .catch((err) => console.warn('push registration skipped:', err.message));
  }, [serverUrl, accessToken]);

  const load = useCallback(async () => {
    if (!serverUrl) return;
    setError(null);
    try {
      const data = await fetchBalances(serverUrl, accessToken);
      setEntries(data.entries || []);
      setUpdatedAt(data.updatedAt);
    } catch (err) {
      setError(`Could not reach server: ${err.message}`);
    }
  }, [serverUrl, accessToken]);

  useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const saveSettings = async () => {
    const trimmedUrl = urlInput.trim().replace(/\/$/, '');
    if (!trimmedUrl) return;
    const trimmedToken = tokenInput.trim();
    await AsyncStorage.setItem(SERVER_URL_KEY, trimmedUrl);
    await AsyncStorage.setItem(ACCESS_TOKEN_KEY, trimmedToken);
    setServerUrl(trimmedUrl);
    setAccessToken(trimmedToken);
    setScreen('dashboard');
  };

  const total = entries.reduce((sum, e) => sum + (e.usdValue || 0), 0);

  if (screen === 'settings') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.settings}>
          <Text style={styles.title}>Crypto Vault</Text>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            value={urlInput}
            onChangeText={setUrlInput}
            placeholder="http://192.168.1.42:3000"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.hint}>
            The address of your crypto-vault server on your network
            (or a tunnel / public URL if you check from outside).
          </Text>
          <Text style={styles.label}>Access token (only if the server needs one)</Text>
          <TextInput
            style={styles.input}
            value={tokenInput}
            onChangeText={setTokenInput}
            placeholder="leave blank for a local server"
            placeholderTextColor="#6b7280"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={{ marginTop: 16 }}>
            <Button title="Save" onPress={saveSettings} />
          </View>
          {serverUrl ? (
            <View style={{ marginTop: 12 }}>
              <Button title="Cancel" color="#6b7280" onPress={() => setScreen('dashboard')} />
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.title}>Crypto Vault</Text>
        <Text style={styles.link} onPress={() => setScreen('settings')}>
          Settings
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={entries}
        keyExtractor={(item) => `${item.chain}:${item.address}`}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#e6e6e6" />
        }
        ListEmptyComponent={<Text style={styles.hint}>No balances yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowLabel}>{item.label}</Text>
              <Text style={styles.rowAddr}>
                {item.chain} · {item.address}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.rowAmount}>
                {item.amount.toFixed(6)} {item.symbol}
              </Text>
              <Text style={styles.rowUsd}>${(item.usdValue || 0).toFixed(2)}</Text>
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <Text style={styles.total}>Total: ${total.toFixed(2)}</Text>
        <Text style={styles.hint}>
          {updatedAt ? `Updated ${new Date(updatedAt).toLocaleTimeString()}` : 'Waiting for server…'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1115' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  title: { color: '#e6e6e6', fontSize: 22, fontWeight: '700' },
  link: { color: '#7dd3fc' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 14,
    marginHorizontal: 12,
    marginVertical: 4,
    backgroundColor: '#171a21',
    borderRadius: 10,
  },
  rowLabel: { color: '#e6e6e6', fontSize: 15, fontWeight: '600' },
  rowAddr: { color: '#6b7280', fontSize: 12, marginTop: 2 },
  rowAmount: { color: '#e6e6e6', fontSize: 15 },
  rowUsd: { color: '#9aa0ab', fontSize: 12, marginTop: 2 },
  footer: { padding: 16, borderTopWidth: 1, borderTopColor: '#2a2d35' },
  total: { color: '#e6e6e6', fontSize: 18, fontWeight: '700' },
  hint: { color: '#6b7280', fontSize: 12, marginTop: 4, paddingHorizontal: 16 },
  error: { color: '#f87171', paddingHorizontal: 16, paddingBottom: 8 },
  settings: { flex: 1, padding: 20 },
  label: { color: '#9aa0ab', marginTop: 20, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#2a2d35',
    borderRadius: 8,
    padding: 12,
    color: '#e6e6e6',
    backgroundColor: '#171a21',
  },
});
