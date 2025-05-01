import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import axios from 'axios';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

interface Todo {
  _id?: string;
  clientId?: string;
  text: string;
  completed: boolean;
  completedAt?: string | null;
}

const HOST = 'localhost';
const API_URL = `http://${HOST}:3000/todos`;
const SYNC_URL = `http://${HOST}:3000/sync`;
const STORAGE_KEY = 'localTodos';

const App: React.FC = () => {
  const [remoteTodos, setRemoteTodos] = useState<Todo[]>([]);
  const [localTodos, setLocalTodos] = useState<Todo[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [statusText, setStatusText] = useState<'Conectado' | 'Sin conexión'>('Conectado');

  const firstConnCheck = useRef(true);

  // Loggea cada vez que cambie localTodos
  useEffect(() => {
    console.log('📂 localTodos state:', localTodos);
  }, [localTodos]);

  /** Inicialización y listener de red **/
  useEffect(() => {
    (async () => {
      const state = await NetInfo.fetch();
      const conn = !!state.isConnected && state.isInternetReachable !== false;
      setIsConnected(conn);
      setStatusText(conn ? 'Conectado' : 'Sin conexión');

      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed: Todo[] = raw ? JSON.parse(raw) : [];
        setLocalTodos(parsed);
      } catch (e) {
        console.warn('⚠️ init loadLocalTodos error', e);
      }

      if (conn) {
        setLoading(true);
        try {
          const res = await axios.get(API_URL);
          const list: Todo[] = Array.isArray(res.data.data) ? res.data.data : res.data;
          setRemoteTodos(list);
        } catch (e) {
          console.warn('⚠️ init loadRemoteTodos error', e);
        } finally {
          setLoading(false);
        }
      }

      firstConnCheck.current = false;
    })();

    const unsub = NetInfo.addEventListener(state => {
      const conn = !!state.isConnected && state.isInternetReachable !== false;
      if (!firstConnCheck.current && !isConnected && conn) {
        syncTodos();
      }
      setIsConnected(conn);
      setStatusText(conn ? 'Conectado' : 'Sin conexión');
    });
    return () => unsub();
  }, []);

  /** addLocal totalmente asíncrono **/
  const addLocal = async (base: Omit<Todo, 'clientId'>) => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      const prev: Todo[] = raw ? JSON.parse(raw) : [];
      const item: Todo = { ...base, clientId: uuidv4() };
      const updated = [item, ...prev];
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setLocalTodos(updated);
    } catch (e) {
      console.warn('⚠️ addLocal error:', e);
    }
  };

  /** Agrega nueva tarea **/
  const addTodo = async () => {
    if (!text.trim()) return Alert.alert('Escribe algo para la tarea');
    const base = { text: text.trim(), completed: false, completedAt: null };
    setText('');

    if (isConnected) {
      try {
        const res = await axios.post(API_URL, base);
        setRemoteTodos(prev => [res.data.todo, ...prev]);
      } catch (e) {
        console.warn('⚠️ remote failed, fallback offline', e);
        await addLocal(base);
      }
    } else {
      await addLocal(base);
    }
  };

  /** Toggle Complete **/
  const toggleComplete = async (item: Todo) => {
    console.log('✔️ toggleComplete on:', item);

    // Rama remota: tiene _id y hay conexión
    if (item._id && isConnected) {
      try {
        const res = await axios.put(
          `${API_URL}/${item._id}`,
          { completed: !item.completed }
        );
        setRemoteTodos(prev =>
          prev.map(t => (t._id === item._id ? res.data.todo : t))
        );
      } catch (e) {
        console.warn('⚠️ toggleComplete remote error', e);
      }

      // Rama offline: cae aquí si no cumple la condición remota
    } else {
      const updated = localTodos.map(t =>
        t.clientId === item.clientId
          ? {
            ...t,
            completed: !t.completed,
            completedAt: !t.completed ? new Date().toISOString() : null
          }
          : t
      );
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setLocalTodos(updated);
    }
  };

  /** Editar tarea **/
  const editTodo = (item: Todo) => {
    Alert.prompt(
      'Editar tarea',
      undefined,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Guardar',
          onPress: async newText => {
            if (!newText?.trim()) return Alert.alert('Texto vacío');
            const update = { text: newText.trim() };

            // Rama remota
            if (item._id && isConnected) {
              try {
                const res = await axios.put(`${API_URL}/${item._id}`, update);
                setRemoteTodos(prev =>
                  prev.map(t => (t._id === item._id ? res.data.todo : t))
                );
              } catch (e) {
                console.warn('⚠️ editTodo remote error', e);
              }

              // Rama offline
            } else {
              const updated = localTodos.map(t =>
                t.clientId === item.clientId ? { ...t, ...update } : t
              );
              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
              setLocalTodos(updated);
            }
          }
        }
      ],
      'plain-text',
      item.text
    );
  };

  /** Eliminar tarea **/
  const removeTodo = async (item: Todo) => {
    console.log('🗑️ removeTodo on:', item);

    // Rama remota
    if (item._id && isConnected) {
      try {
        await axios.delete(`${API_URL}/${item._id}`);
        setRemoteTodos(prev => prev.filter(t => t._id !== item._id));
      } catch (e) {
        console.warn('⚠️ removeTodo remote error', e);
      }

      // Rama offline
    } else {
      const updated = localTodos.filter(t => t.clientId !== item.clientId);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      setLocalTodos(updated);
    }
  };

  /** Sincronizar pendientes **/
  const syncTodos = async () => {
    if (!isConnected) return Alert.alert('Sin conexión');
    if (!localTodos.length) return Alert.alert('No hay tareas pendientes');
    setLoading(true);
    try {
      const res = await axios.post(SYNC_URL, { todos: localTodos });
      if ([200, 207].includes(res.status)) {
        Alert.alert('Sincronización exitosa');
        await AsyncStorage.removeItem(STORAGE_KEY);
        setLocalTodos([]);
        const rem = await axios.get(API_URL);
        const list: Todo[] = Array.isArray(rem.data.data) ? rem.data.data : rem.data;
        setRemoteTodos(list);
      } else {
        Alert.alert('Error al sincronizar');
      }
    } catch (e) {
      Alert.alert('Fallo al sincronizar');
      console.warn('⚠️ syncTodos error', e);
    } finally {
      setLoading(false);
    }
  };

  const display = isConnected ? [...localTodos, ...remoteTodos] : localTodos;
  const pendingCount = localTodos.length;

  const renderItem = ({ item }: { item: Todo }) => (
    <View style={[styles.card, item.completed && styles.cardCompleted]}>
      <TouchableOpacity onPress={() => toggleComplete(item)} style={styles.checkBox}>
        <Text>{item.completed ? '✅' : '◻️'}</Text>
      </TouchableOpacity>
      <TouchableOpacity onLongPress={() => editTodo(item)} style={styles.textContainer}>
        <Text style={[styles.cardText, item.completed && styles.textDone]}>
          {item.text}
        </Text>
        {item.completedAt && (
          <Text style={styles.dateText}>
            {new Date(item.completedAt).toLocaleDateString('es-ES')}
          </Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={() => removeTodo(item)} style={styles.deleteBtn}>
        <Text>🗑️</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <Text style={[styles.status, { color: isConnected ? '#28a745' : '#dc3545' }]}>
        {statusText}
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder="¿Qué hay que hacer?"
          value={text}
          onChangeText={setText}
        />
        <TouchableOpacity style={styles.addBtn} onPress={addTodo}>
          <Text style={styles.addBtnText}>＋</Text>
        </TouchableOpacity>
      </View>
      {loading ? (
        <ActivityIndicator size="large" style={{ marginTop: 20 }} />
      ) : display.length === 0 ? (
        <Text style={styles.empty}>No hay tareas</Text>
      ) : (
        <FlatList
          data={display}
          renderItem={renderItem}
          keyExtractor={item => item._id ?? item.clientId!}
          contentContainerStyle={{ paddingBottom: 100 }}
        />
      )}
      {isConnected && pendingCount > 0 && (
        <TouchableOpacity style={styles.syncBtn} onPress={syncTodos}>
          <Text style={styles.syncText}>Sincronizar ({pendingCount})</Text>
        </TouchableOpacity>
      )}
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    backgroundColor: '#f8f9fa'
  },
  status: { textAlign: 'center', marginBottom: 10, fontWeight: '600' },
  inputRow: { flexDirection: 'row', marginBottom: 15 },
  input: {
    flex: 1,
    backgroundColor: '#fff',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 25,
    fontSize: 16,
    elevation: 2
  },
  addBtn: {
    marginLeft: 10,
    backgroundColor: '#007bff',
    borderRadius: 25,
    padding: 12,
    elevation: 3,
    justifyContent: 'center',
    alignItems: 'center'
  },
  addBtnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  empty: { textAlign: 'center', marginTop: 50, color: '#6c757d' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    marginVertical: 6,
    padding: 12,
    borderRadius: 8,
    elevation: 1
  },
  cardCompleted: { opacity: 0.6 },
  checkBox: { marginRight: 12 },
  textContainer: { flex: 1 },
  cardText: { fontSize: 16 },
  textDone: { textDecorationLine: 'line-through', color: '#6c757d' },
  dateText: { fontSize: 12, color: '#6c757d', marginTop: 4 },
  deleteBtn: { marginLeft: 12 },
  syncBtn: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    backgroundColor: '#ffc107',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 30,
    elevation: 4
  },
  syncText: { color: '#212529', fontWeight: '600' }
});

export default App;
