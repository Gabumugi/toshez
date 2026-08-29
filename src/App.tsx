import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { 
  Send, Users, Sparkles, Image as ImageIcon, Video, FileText, Mic, StopCircle, 
  Smile, Share2, Copy, Check, MessageSquare, ArrowLeft, 
  RefreshCw, Radio, Compass, ShieldCheck, Terminal, CornerDownLeft, Trash2, Pin,
  Lock, Globe, Bell, Megaphone, Plus, LogIn, Settings
} from 'lucide-react';
import { User, Message, RoomMeta } from './types';

// Helper for random avatars & names
const ANIMAL_NAMES = [
  'Cosmic Panda', 'Nebula Fox', 'Cyber Wolf', 'Quantum Otter', 'Solar Falcon',
  'Astro Bear', 'Pixel Panther', 'Zen Badger', 'Sonic Hawk', 'Nova Tiger'
];

const AVATARS = ['🐼', '🦊', '🐺', '🦦', '🦅', '🐻', '🐆', '🦡', '🦉', '🐅'];
const COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#14b8a6'];

function getRandomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function App() {
  // Session & User state
  const [user, setUser] = useState<User>(() => {
    const saved = localStorage.getItem('pulsechat_user');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      name: getRandomItem(ANIMAL_NAMES),
      avatar: getRandomItem(AVATARS),
      color: getRandomItem(COLORS)
    };
  });

  const [roomId, setRoomId] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const r = params.get('room');
    if (r) return r.toLowerCase().replace(/[^a-z0-9-_]/g, '');
    return 'lobby';
  });

  const [roomPasscode, setRoomPasscode] = useState<string>('');
  const [passcodePrompt, setPasscodePrompt] = useState<{ roomId: string; name: string } | null>(null);
  const [enteredPasscode, setEnteredPasscode] = useState<string>('');

  const [joined, setJoined] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeUsers, setActiveUsers] = useState<User[]>([]);
  const [roomMeta, setRoomMeta] = useState<RoomMeta | null>(null);
  const [inputText, setInputText] = useState<string>('');
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showUsersDrawer, setShowUsersDrawer] = useState<boolean>(false);
  const [showRoomsDrawer, setShowRoomsDrawer] = useState<boolean>(false);
  const [showCreateRoomModal, setShowCreateRoomModal] = useState<boolean>(false);
  const [showAnnouncementModal, setShowAnnouncementModal] = useState<boolean>(false);
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [announcementText, setAnnouncementText] = useState<string>('');

  const [settings, setSettings] = useState<{ compactMode: boolean; disableSound: boolean }>(() => {
    const saved = localStorage.getItem('pulsechat_settings');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return { compactMode: false, disableSound: false };
  });

  useEffect(() => {
    localStorage.setItem('pulsechat_settings', JSON.stringify(settings));
  }, [settings]);

  // New Room form state
  const [newRoomIdInput, setNewRoomIdInput] = useState<string>('');
  const [newRoomNameInput, setNewRoomNameInput] = useState<string>('');
  const [newRoomIsPrivate, setNewRoomIsPrivate] = useState<boolean>(false);
  const [newRoomPasscode, setNewRoomPasscode] = useState<string>('');

  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const typingTimeoutRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [previewUsers, setPreviewUsers] = useState<{id: string; name: string; avatar: string; color: string}[]>([]);

  // Save user profile changes
  useEffect(() => {
    localStorage.setItem('pulsechat_user', JSON.stringify(user));
  }, [user]);

  // Fetch preview users for lobby screen
  useEffect(() => {
    if (joined || !roomId) {
      setPreviewUsers([]);
      return;
    }
    const fetchPreview = async () => {
      try {
        const res = await fetch(`/api/room/${roomId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.users) {
            setPreviewUsers(data.users);
          }
        }
      } catch (e) {
        // ignore
      }
    };
    fetchPreview();
    const pollInterval = setInterval(fetchPreview, 3000);
    return () => clearInterval(pollInterval);
  }, [joined, roomId]);

  const handleLeave = () => {
    setJoined(false);
    setMessages([]);
    setActiveUsers([]);
    setRoomMeta(null);
  };

  // Room state polling and initial fetch fallback
  useEffect(() => {
    if (!joined || !roomId) return;

    const fetchRoomState = async () => {
      try {
        const res = await fetch(`/api/room/${roomId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.messages && data.messages.length > 0) {
            setMessages(data.messages);
          }
          if (data.users) {
            setActiveUsers(data.users);
          }
          if (data.meta) {
            setRoomMeta(data.meta);
          }
        }
      } catch (e) {
        console.error("Failed to fetch room state", e);
      }
    };

    fetchRoomState();
    const pollInterval = setInterval(fetchRoomState, 3000);
    return () => clearInterval(pollInterval);
  }, [joined, roomId]);

  // Connect WebSocket when joined
  useEffect(() => {
    if (!joined) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({
        type: 'join',
        payload: { roomId, passcode: roomPasscode, user }
      }));
    };

    ws.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data);
        const { type, payload } = packet;

        if (type === 'error') {
          alert(payload.message);
          setPasscodePrompt({ roomId, name: roomId });
          setJoined(false);
          setMessages([]);
          setActiveUsers([]);
          setRoomMeta(null);
        } else if (type === 'room_init') {
          setMessages(payload.messages);
          setActiveUsers(payload.users);
          setRoomMeta(payload.meta || null);
          setPasscodePrompt(null);
          playChime();
        } else if (type === 'new_message') {
          setMessages(prev => [...prev, payload]);
          playPop();
        } else if (type === 'user_joined' || type === 'user_left') {
          setActiveUsers(payload.users);
        } else if (type === 'typing') {
          const { user: typingUser, isTyping } = payload;
          setTypingUsers(prev => {
            if (isTyping) {
              if (!prev.includes(typingUser.name)) return [...prev, typingUser.name];
            } else {
              return prev.filter(name => name !== typingUser.name);
            }
            return prev;
          });
        } else if (type === 'reaction_update') {
          setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m));
        } else if (type === 'pin_update') {
          setMessages(prev => prev.map(m => m.id === payload.messageId ? { ...m, isPinned: payload.isPinned } : m));
        } else if (type === 'read_receipt_update') {
          const updatedMessages = payload.messages;
          setMessages(prev => prev.map(m => {
            const found = updatedMessages.find((um: any) => um.id === m.id);
            return found ? { ...m, seenBy: found.seenBy } : m;
          }));
        } else if (type === 'room_created') {
          setRoomId(payload.roomId);
          setJoined(true);
          setShowCreateRoomModal(false);
        }
      } catch (e) {
        console.error("Failed to parse ws message", e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    // Auto-reconnect timer if disconnected while joined
    const reconnectTimer = setInterval(() => {
      if (joined && wsRef.current && wsRef.current.readyState === WebSocket.CLOSED) {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;
        const newWs = new WebSocket(wsUrl);
        wsRef.current = newWs;

        newWs.onopen = ws.onopen;
        newWs.onmessage = ws.onmessage;
        newWs.onclose = ws.onclose;
      }
    }, 3000);

    return () => {
      clearInterval(reconnectTimer);
      ws.close();
    };
  }, [joined, roomId]);

  // Scroll to bottom on new messages and mark seen
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    if (joined && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'mark_seen' }));
    }
  }, [messages.length, joined]);

  const playPop = () => {
    if (settings.disableSound) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(580, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) {}
  };

  const playChime = () => {
    if (settings.disableSound) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const now = ctx.currentTime;
      [440, 554.37, 659.25].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.08, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.3);
      });
    } catch (e) {}
  };

  const handleSendMessage = async (e: React.FormEvent, customType?: 'text' | 'image' | 'video' | 'file' | 'audio', fileMeta?: { content: string; fileName?: string; fileSize?: string }) => {
    if (e) e.preventDefault();
    const content = fileMeta ? fileMeta.content : inputText.trim();
    if (!content) return;

    const payloadData = {
      user,
      content,
      type: customType || 'text',
      fileName: fileMeta?.fileName,
      fileSize: fileMeta?.fileSize,
      replyTo: replyingTo ? { id: replyingTo.id, senderName: replyingTo.sender.name, content: replyingTo.content.substring(0, 50) } : undefined
    };

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        payload: payloadData
      }));
    } else {
      try {
        const res = await fetch(`/api/room/${roomId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadData)
        });
        if (res.ok) {
          const data = await res.json();
          if (data.message) {
            setMessages(prev => [...prev, data.message]);
            playPop();
          }
        }
      } catch (err) {
        console.error("Failed to send message via REST fallback", err);
      }
    }

    setInputText('');
    setReplyingTo(null);
    sendTyping(false);
  };

  const handleSendAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!announcementText.trim()) return;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'message',
        payload: {
          content: `📢 **PUBLIC ANNOUNCEMENT**: ${announcementText.trim()}`,
          type: 'text',
          isAnnouncement: true
        }
      }));
    }

    setAnnouncementText('');
    setShowAnnouncementModal(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputText(e.target.value);
    sendTyping(true);

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      sendTyping(false);
    }, 2000);
  };

  const sendTyping = (isTyping: boolean) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'typing',
        payload: { isTyping }
      }));
    }
  };

  const handleAddReaction = (messageId: string, emoji: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'reaction',
        payload: { messageId, emoji }
      }));
    }
  };

  const handleTogglePin = (messageId: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'pin',
        payload: { messageId }
      }));
    }
  };

  // Media File Upload Handlers (Images, Videos, Docs)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, mediaType: 'image' | 'video' | 'file') => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Size limit check (e.g. 25MB)
    if (file.size > 25 * 1024 * 1024) {
      alert("File size exceeds 25MB limit.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result as string;
      const sizeStr = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
      handleSendMessage(null as any, mediaType, {
        content: base64,
        fileName: file.name,
        fileSize: sizeStr
      });
    };
    reader.readAsDataURL(file);
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const base64Audio = reader.result as string;
          handleSendMessage(null as any, 'audio', { content: base64Audio });
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone permission denied or not supported.");
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const copyRoomLink = () => {
    const url = `${window.location.origin}?room=${roomId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const randomizeProfile = () => {
    setUser({
      id: user.id,
      name: getRandomItem(ANIMAL_NAMES),
      avatar: getRandomItem(AVATARS),
      color: getRandomItem(COLORS)
    });
  };

  const handleCreateRoomSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomIdInput.trim()) return;

    const cleanId = newRoomIdInput.toLowerCase().replace(/[^a-z0-9-_]/g, '');
    try {
      const res = await fetch('/api/room/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: cleanId,
          name: newRoomNameInput.trim() || cleanId,
          isPrivate: newRoomIsPrivate,
          passcode: newRoomIsPrivate ? newRoomPasscode : undefined,
          user
        })
      });
      if (res.ok) {
        setRoomId(cleanId);
        if (newRoomIsPrivate) {
          setRoomPasscode(newRoomPasscode);
        } else {
          setRoomPasscode('');
        }
        setShowCreateRoomModal(false);
        setJoined(true);
      }
    } catch (err) {
      console.error("Failed to create room", err);
      setRoomId(cleanId);
      if (newRoomIsPrivate) setRoomPasscode(newRoomPasscode);
      setShowCreateRoomModal(false);
      setJoined(true);
    }
  };

  // 1. Setup / Lobby screen if not joined
  if (!joined) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex overflow-hidden">
        
        {/* Main Content */}
        <div className="flex-1 flex items-center justify-center p-4 relative overflow-y-auto">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-indigo-950/50 via-slate-950 to-slate-950 -z-10" />
          
          <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-800/80 rounded-2xl p-8 shadow-2xl space-y-6 my-auto">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 text-3xl shadow-inner mb-2">
                ⚡
              </div>
              <h1 className="text-3xl font-bold tracking-tight text-white">PulseChat</h1>
              <p className="text-sm text-slate-400">
                Passwordless & Loginless Browser Chat.
              </p>
            </div>

          <div className="space-y-4">
            {/* Identity Card */}
            <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Identity</span>
                <button 
                  onClick={randomizeProfile}
                  className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1 transition"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Randomize
                </button>
              </div>

              <div className="flex items-center gap-3">
                <div 
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl shadow-md border border-white/10"
                  style={{ backgroundColor: user.color + '33' }}
                >
                  {user.avatar}
                </div>
                <div className="flex-1">
                  <input
                    type="text"
                    value={user.name}
                    onChange={(e) => setUser({ ...user, name: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-sm font-medium text-white focus:outline-none focus:border-indigo-500 transition"
                    placeholder="Enter nickname..."
                  />
                </div>
              </div>
            </div>

            {/* Room Selection */}
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Room Name</label>
              <div className="relative">
                <Compass className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                  placeholder="e.g. lobby, tech-talk, secret-room"
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            {/* Passcode input if needed */}
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wider text-slate-400">Room Passcode (If Private)</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                <input
                  type="password"
                  value={roomPasscode}
                  onChange={(e) => setRoomPasscode(e.target.value)}
                  placeholder="Optional Passcode"
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pl-10 pr-4 py-3 text-sm text-white focus:outline-none focus:border-indigo-500 transition"
                />
              </div>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <span className="text-xs text-slate-500">Popular Rooms:</span>
              <div className="flex flex-wrap gap-2">
                {['lobby', 'tech-talk', 'announcements', 'media-share'].map((room) => (
                  <button
                    key={room}
                    onClick={() => { setRoomId(room); setRoomPasscode(''); }}
                    className={`text-xs px-3 py-1.5 rounded-lg border transition ${
                      roomId === room 
                        ? 'bg-indigo-600/30 border-indigo-500 text-indigo-300' 
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    #{room}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  if (!roomId.trim()) return;
                  setJoined(true);
                }}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white font-medium py-3 rounded-xl shadow-lg shadow-indigo-600/25 transition flex items-center justify-center gap-2"
              >
                <span>Join Room</span>
                <Radio className="w-4 h-4" />
              </button>
              <button
                onClick={() => setShowCreateRoomModal(true)}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium px-4 py-3 rounded-xl transition border border-slate-700/60 flex items-center gap-1.5 text-xs"
              >
                <Plus className="w-4 h-4 text-indigo-400" /> New Room
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-slate-800/60 flex items-center justify-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Passwordless</span>
            <span>•</span>
            <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-indigo-400" /> AI Bot</span>
            <span>•</span>
            <span className="flex items-center gap-1"><Video className="w-3.5 h-3.5 text-cyan-400" /> Media Ready</span>
          </div>
        </div>

        {/* Create Room Modal */}
        {showCreateRoomModal && (
          <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <Plus className="w-5 h-5 text-indigo-400" /> Create Room
                </h3>
                <button onClick={() => setShowCreateRoomModal(false)} className="text-slate-400 hover:text-white">✕</button>
              </div>

              <form onSubmit={handleCreateRoomSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 font-medium"> Room ID</label>
                  <input
                    type="text"
                    value={newRoomIdInput}
                    onChange={(e) => setNewRoomIdInput(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                    placeholder="e.g. design-sprint"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-slate-400 font-medium">Room Display Name</label>
                  <input
                    type="text"
                    value={newRoomNameInput}
                    onChange={(e) => setNewRoomNameInput(e.target.value)}
                    placeholder="e.g. Design Sprint Team"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <input
                    type="checkbox"
                    id="isPrivate"
                    checked={newRoomIsPrivate}
                    onChange={(e) => setNewRoomIsPrivate(e.target.checked)}
                    className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="isPrivate" className="text-sm text-slate-300 font-medium flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-amber-400" /> Private Room 
                  </label>
                </div>

                {newRoomIsPrivate && (
                  <div className="space-y-1">
                    <label className="text-xs text-slate-400 font-medium">Room Passcode</label>
                    <input
                      type="password"
                      value={newRoomPasscode}
                      onChange={(e) => setNewRoomPasscode(e.target.value)}
                      placeholder="Enter secret passcode"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                      required={newRoomIsPrivate}
                    />
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowCreateRoomModal(false)}
                    className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20"
                  >
                    Create & Enter
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        </div>
        
        {/* ONLINE NOW Sidebar (Lobby preview) */}
        <div className={`w-80 bg-slate-900 border-l border-slate-800 flex flex-col transition-all duration-300 hidden lg:flex`}>
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Compass className="w-4 h-4 text-indigo-400" />
              Lobby: #{roomId || '...'}
            </h3>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="uppercase tracking-wider flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> ONLINE NOW ({previewUsers.length})
              </span>
              {previewUsers.length > 0 && <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
            </div>

            {previewUsers.length === 0 ? (
              <div className="text-sm text-slate-500 italic mt-4 text-center">No one is currently in this room.</div>
            ) : (
              <div className="space-y-2 mt-2">
                {previewUsers.map((u, i) => (
                  <div key={u.id + i} className="flex items-center gap-3 p-2 rounded-xl bg-slate-950/40 border border-slate-800/50">
                    <div 
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shadow-inner border border-white/5"
                      style={{ backgroundColor: u.color + '33' }}
                    >
                      {u.avatar}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-200 truncate flex items-center gap-1.5">
                        {u.name}
                      </div>
                      <div className="text-[11px] text-emerald-400 flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    );
  }

  // 2. Main Chat Room View
  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Sidebar - Active Users & Rooms */}
      <div className={`fixed inset-y-0 left-0 z-50 w-72 bg-slate-900 border-r border-slate-800 flex flex-col transition-transform duration-300 lg:static lg:translate-x-0 ${showUsersDrawer ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold">⚡</div>
            <span className="font-bold text-white tracking-tight">PulseChat</span>
          </div>
          <button 
            onClick={() => setShowUsersDrawer(false)}
            className="lg:hidden text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Room Info Header */}
        <div className="p-4 border-b border-slate-800/60 bg-slate-950/40 space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="uppercase tracking-wider flex items-center gap-1">
              {roomMeta?.isPrivate ? <Lock className="w-3 h-3 text-amber-400" /> : <Globe className="w-3 h-3 text-emerald-400" />}
              {roomMeta?.isPrivate ? 'Private Room' : 'Public Room'}
            </span>
            <span className="text-indigo-400 font-mono font-medium">#{roomId}</span>
          </div>
          <div className="text-sm font-bold text-white truncate">{roomMeta?.name || `#${roomId}`}</div>
          
          <div className="flex gap-2">
            <button
              onClick={copyRoomLink}
              className="flex-1 bg-slate-800 hover:bg-slate-700/80 text-slate-200 text-xs font-medium py-2 px-3 rounded-lg flex items-center justify-center gap-1.5 transition border border-slate-700/50"
            >
              {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5 text-indigo-400" />}
              <span>{copiedLink ? 'Copied Link' : 'Invite Link'}</span>
            </button>
            <button
              onClick={() => setShowAnnouncementModal(true)}
              title="Push Public Announcement"
              className="bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs px-2.5 py-2 rounded-lg flex items-center justify-center transition"
            >
              <Megaphone className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Online Users List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span className="uppercase tracking-wider flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Online Now ({activeUsers.length})
            </span>
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          </div>

          <div className="space-y-2">
            {activeUsers.map((u, i) => (
              <div key={u.id + i} className="flex items-center gap-3 p-2 rounded-xl bg-slate-950/40 border border-slate-800/50">
                <div 
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-lg shadow-inner border border-white/5"
                  style={{ backgroundColor: u.color + '33' }}
                >
                  {u.avatar}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-200 truncate flex items-center gap-1.5">
                    {u.name}
                    {u.id === user.id && <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1.5 py-0.5 rounded font-normal">You</span>}
                  </div>
                  <div className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Active
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* User Identity Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div 
              className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow"
              style={{ backgroundColor: user.color + '33' }}
            >
              {user.avatar}
            </div>
            <div>
              <div className="text-sm font-medium text-white truncate max-w-[120px]">{user.name}</div>
              <div className="text-[11px] text-slate-400">Guest</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowSettingsModal(true)}
              title="User Settings"
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition border border-slate-700/50"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={handleLeave}
              title="Leave Room / Switch Profile"
              className="text-xs bg-slate-800 hover:bg-rose-950/60 hover:text-rose-400 text-slate-300 px-3 py-1.5 rounded-lg transition border border-slate-700/50"
            >
              Leave
            </button>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-slate-950">
        {/* Chat Header */}
        <div className="h-16 border-b border-slate-800 bg-slate-900/60 backdrop-blur-md px-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowUsersDrawer(true)}
              className="lg:hidden p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
            >
              <Users className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span className="flex items-center gap-1.5">
                  {roomMeta?.isPrivate ? <Lock className="w-4 h-4 text-amber-400" /> : <Globe className="w-4 h-4 text-emerald-400" />}
                  {roomMeta?.name || `#${roomId}`}
                </span>
                <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" /> Live
                </span>
              </h2>
              <p className="text-xs text-slate-400">Media Chat <code className="text-indigo-400 font-mono">@keplerai</code> for ENB</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateRoomModal(true)}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium px-3 py-2 rounded-xl flex items-center gap-1.5 transition shadow-sm"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-400" />
              <span className="hidden sm:inline">New Room</span>
            </button>
            <button
              onClick={copyRoomLink}
              className="bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 text-xs font-medium px-3 py-2 rounded-xl flex items-center gap-1.5 transition shadow-sm"
            >
              <Share2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Invite</span>
            </button>
          </div>
        </div>

        {/* Pinned Messages Header Bar */}
        {messages.filter(m => m.isPinned).length > 0 && (
          <div className="bg-slate-900/90 border-b border-indigo-500/30 px-4 py-2.5 flex items-center gap-3 overflow-x-auto shrink-0 shadow-md">
            <div className="flex items-center gap-1.5 text-indigo-400 font-semibold text-xs shrink-0 bg-indigo-950/60 px-2.5 py-1 rounded-lg border border-indigo-500/30">
              <Pin className="w-3.5 h-3.5 rotate-45" />
              <span>Pinned ({messages.filter(m => m.isPinned).length})</span>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto">
              {messages.filter(m => m.isPinned).map(pinnedMsg => (
                <div 
                  key={'pinned_' + pinnedMsg.id}
                  className="bg-slate-950/80 border border-slate-800 hover:border-indigo-500/50 rounded-xl px-3 py-1.5 text-xs flex items-center gap-2 shrink-0 group transition cursor-pointer"
                  onClick={() => {
                    const el = document.getElementById(`msg_${pinnedMsg.id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                >
                  <span className="font-semibold text-slate-300">{pinnedMsg.sender.name}:</span>
                  <span className="text-slate-400 max-w-[180px] truncate">{pinnedMsg.content}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTogglePin(pinnedMsg.id);
                    }}
                    className="text-slate-500 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition p-0.5"
                    title="Unpin message"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Message Stream */}
        <div className={`flex-1 overflow-y-auto p-4 sm:p-6 ${settings.compactMode ? 'space-y-2' : 'space-y-4'}`}>
          {messages.map((msg) => {
            const isMe = msg.sender.id === user.id;
            const isBot = msg.sender.isBot;
            const isAnnouncement = msg.isAnnouncement;

            return (
              <div 
                key={msg.id} 
                id={`msg_${msg.id}`}
                className={`flex gap-3 max-w-3xl animate-fade-in-up ${isMe ? 'ml-auto flex-row-reverse' : ''}`}
              >
                <div 
                  className={`${settings.compactMode ? 'w-8 h-8 rounded-lg text-base mt-0.5' : 'w-10 h-10 rounded-xl text-xl mt-1'} flex items-center justify-center shrink-0 shadow-md border border-white/10`}
                  style={{ backgroundColor: msg.sender.color + '33' }}
                >
                  {msg.sender.avatar || (isBot ? '🤖' : '👤')}
                </div>

                <div className={`space-y-1.5 ${isMe ? 'items-end text-right' : ''}`}>
                  <div className={`flex items-center gap-2 text-xs text-slate-400 ${isMe ? 'flex-row-reverse' : ''}`}>
                    <span className="font-semibold text-slate-200">{msg.sender.name}</span>
                    {isBot && <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-1.5 py-0.2 rounded text-[10px]">AI Bot</span>}
                    {isAnnouncement && <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 px-1.5 py-0.2 rounded text-[10px] font-bold">Announcement</span>}
                    <span>•</span>
                    <span title={`Sent at ${new Date(msg.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}, ${new Date(msg.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {isMe && (
                      <span className="inline-flex items-center ml-1 text-xs" title={msg.seenBy && msg.seenBy.length > 0 ? `Seen by other users` : 'Delivered'}>
                        {msg.seenBy && msg.seenBy.length > 0 ? (
                          <span className="text-cyan-300 font-bold tracking-tight" title="Seen">✓✓</span>
                        ) : (
                          <span className="text-slate-400">✓</span>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Reply Reference Preview */}
                  {msg.replyTo && (
                    <div className={`text-xs bg-slate-900/80 border-l-2 border-indigo-500 px-3 py-1 rounded text-slate-400 italic mb-1 max-w-md truncate ${isMe ? 'text-right' : ''}`}>
                      Replying to <b>{msg.replyTo.senderName}</b>: {msg.replyTo.content}
                    </div>
                  )}

                  {/* Message Bubble with Responsive Media Support */}
                  <div className={`group relative shadow-md text-sm leading-relaxed ${settings.compactMode ? 'rounded-xl px-3 py-1.5' : 'rounded-2xl px-4 py-3'} ${
                    isAnnouncement
                      ? 'bg-amber-950/40 border border-amber-500/50 text-amber-200 rounded-lg w-full'
                      : isMe 
                        ? 'bg-indigo-600 text-white rounded-tr-sm' 
                        : isBot 
                          ? 'bg-slate-900 border border-indigo-500/30 text-slate-100 rounded-tl-sm' 
                          : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-tl-sm'
                  }`}>
                    {msg.type === 'image' ? (
                      <img 
                        src={msg.content} 
                        alt="Shared upload" 
                        onClick={() => setLightboxImage(msg.content)}
                        className="max-w-xs sm:max-w-md w-full rounded-xl border border-white/10 shadow-md cursor-pointer hover:opacity-90 transition object-cover" 
                      />
                    ) : msg.type === 'video' ? (
                      <video 
                        controls 
                        src={msg.content} 
                        className="max-w-xs sm:max-w-md w-full rounded-xl border border-white/10 shadow-md bg-black" 
                      />
                    ) : msg.type === 'file' ? (
                      <div className="flex items-center gap-3 bg-slate-950/60 p-3 rounded-xl border border-slate-800 max-w-sm">
                        <div className="p-2.5 rounded-lg bg-indigo-600/20 text-indigo-400 shrink-0">
                          <FileText className="w-6 h-6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-white truncate">{msg.fileName || 'Document'}</div>
                          <div className="text-xs text-slate-400">{msg.fileSize || 'Attached File'}</div>
                        </div>
                        <a 
                          href={msg.content} 
                          download={msg.fileName || 'download'} 
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition shadow-sm shrink-0"
                        >
                          Download
                        </a>
                      </div>
                    ) : msg.type === 'audio' ? (
                      <audio controls src={msg.content} className="max-w-xs h-10" />
                    ) : (
                      <div className="markdown-body prose prose-invert max-w-none text-sm">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                    )}

                    {/* Quick Action Hover Bar */}
                    <div className={`absolute top-2 opacity-0 group-hover:opacity-100 transition flex items-center gap-1 bg-slate-950/80 backdrop-blur border border-slate-700/80 px-2 py-1 rounded-lg shadow-lg ${
                      isMe ? '-left-28' : '-right-28'
                    }`}>
                      <button 
                        onClick={() => handleAddReaction(msg.id, '❤️')} 
                        className="hover:scale-125 transition p-1 text-xs"
                        title="Love"
                      >
                        ❤️
                      </button>
                      <button 
                        onClick={() => handleAddReaction(msg.id, '👍')} 
                        className="hover:scale-125 transition p-1 text-xs"
                        title="Thumbs up"
                      >
                        👍
                      </button>
                      <button 
                        onClick={() => handleAddReaction(msg.id, '🔥')} 
                        className="hover:scale-125 transition p-1 text-xs"
                        title="Fire"
                      >
                        🔥
                      </button>
                      <button 
                        onClick={() => setReplyingTo(msg)} 
                        className="hover:text-indigo-400 transition p-1 text-xs text-slate-300"
                        title="Reply"
                      >
                        <CornerDownLeft className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={() => handleTogglePin(msg.id)} 
                        className={`hover:text-indigo-400 transition p-1 text-xs ${msg.isPinned ? 'text-indigo-400' : 'text-slate-300'}`}
                        title={msg.isPinned ? 'Unpin message' : 'Pin message'}
                      >
                        <Pin className={`w-3.5 h-3.5 rotate-45 ${msg.isPinned ? 'fill-indigo-400' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {/* Reactions List */}
                  {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                    <div className={`flex flex-wrap gap-1.5 pt-1 ${isMe ? 'justify-end' : ''}`}>
                      {Object.entries(msg.reactions).map(([emoji, names]) => (
                        <button
                          key={emoji}
                          onClick={() => handleAddReaction(msg.id, emoji)}
                          className="text-xs bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 px-2 py-0.5 rounded-full flex items-center gap-1 transition shadow-sm"
                          title={`Reacted by: ${names.join(', ')}`}
                        >
                          <span>{emoji}</span>
                          <span className="text-[10px] font-medium text-slate-400">{names.length}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Typing Indicator */}
          {typingUsers.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-slate-400 italic bg-slate-900/40 w-fit px-3 py-2 rounded-xl border border-slate-800/50">
              <span className="flex gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce [animation-delay:0.4s]" />
              </span>
              <span>{typingUsers.join(', ')} {typingUsers.length === 1 ? 'is' : 'are'} typing...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Reply banner if replying */}
        {replyingTo && (
          <div className="px-4 py-2 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 text-slate-300 truncate">
              <CornerDownLeft className="w-4 h-4 text-indigo-400 shrink-0" />
              <span>Replying to <b>{replyingTo.sender.name}</b>: {replyingTo.content.substring(0, 60)}...</span>
            </div>
            <button 
              onClick={() => setReplyingTo(null)}
              className="text-slate-500 hover:text-white px-2 py-1 font-bold"
            >
              ✕
            </button>
          </div>
        )}

        {/* Input Footer */}
        <div className="p-4 bg-slate-900/80 border-t border-slate-800/80 backdrop-blur-md">
          <form onSubmit={handleSendMessage} className="flex items-center gap-2 max-w-4xl mx-auto">
            {/* Image Upload */}
            <label className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer transition border border-slate-700/50 shadow-sm" title="Upload Image">
              <ImageIcon className="w-5 h-5 text-emerald-400" />
              <input type="file" accept="image/*" onChange={(e) => handleFileUpload(e, 'image')} className="hidden" />
            </label>

            {/* Video Upload */}
            <label className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer transition border border-slate-700/50 shadow-sm" title="Upload Video Clip">
              <Video className="w-5 h-5 text-cyan-400" />
              <input type="file" accept="video/*" onChange={(e) => handleFileUpload(e, 'video')} className="hidden" />
            </label>

            {/* Document / File Upload */}
            <label className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer transition border border-slate-700/50 shadow-sm" title="Upload Document">
              <FileText className="w-5 h-5 text-amber-400" />
              <input type="file" accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.zip" onChange={(e) => handleFileUpload(e, 'file')} className="hidden" />
            </label>

            {/* Voice record button */}
            <button
              type="button"
              onClick={isRecording ? stopVoiceRecording : startVoiceRecording}
              className={`p-2.5 rounded-xl transition border shadow-sm ${
                isRecording 
                  ? 'bg-rose-600/20 border-rose-500 text-rose-400 animate-pulse' 
                  : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/50'
              }`}
              title={isRecording ? 'Stop Recording' : 'Record Voice Note'}
            >
              {isRecording ? <StopCircle className="w-5 h-5 text-rose-400" /> : <Mic className="w-5 h-5 text-pink-400" />}
            </button>

            {/* Emoji Picker Button & Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowEmojiPicker(prev => !prev)}
                className={`p-2.5 rounded-xl transition border shadow-sm ${
                  showEmojiPicker 
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400' 
                    : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border-slate-700/50'
                }`}
                title="Insert Emoji"
              >
                <Smile className="w-5 h-5 text-amber-400" />
              </button>

              {showEmojiPicker && (
                <div className="absolute bottom-14 left-0 z-50 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-2xl w-72 backdrop-blur-xl animate-fade-in">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                    <span className="text-xs font-semibold text-slate-300">Select Emoji</span>
                    <button onClick={() => setShowEmojiPicker(false)} className="text-slate-400 hover:text-white text-xs">✕</button>
                  </div>
                  <div className="grid grid-cols-8 gap-1.5 max-h-48 overflow-y-auto">
                    {['😀', '😂', '😍', '🔥', '👍', '❤️', '🎉', '🚀', '✨', '👏', '🤔', '👀', '💯', '😎', '🙌', '💻', '⚡', '☕', '🤖', '🎯', '🥳', '🙏', '💪', '⭐', '😢', '💡', '💬', '🏆', '🍀', '🍕', '🍻', '🌈'].map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          setInputText(prev => prev + emoji);
                          setShowEmojiPicker(false);
                        }}
                        className="h-8 w-8 flex items-center justify-center hover:bg-slate-800 rounded-lg text-lg transition"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Main Text Input */}
            <div className="flex-1 relative">
              <input
                type="text"
                value={inputText}
                onChange={handleInputChange}
                placeholder="Type message, upload media, or type @ai for Gemini..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition shadow-inner"
              />
            </div>

            {/* Send Button */}
            <button
              type="submit"
              disabled={!inputText.trim()}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:hover:bg-indigo-600 text-white p-3 rounded-xl shadow-lg shadow-indigo-600/25 transition flex items-center justify-center"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
          <div className="text-center mt-2">
            <span className="text-[11px] text-slate-500">
              Passwordless & Loginless <code className="text-indigo-400">@KEPLER [question]</code> Camp Codes
            </span>
          </div>
        </div>
      </div>

      {/* Lightbox Modal */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] flex items-center justify-center" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => setLightboxImage(null)}
              className="absolute -top-12 right-0 text-slate-400 hover:text-white bg-slate-900/80 border border-slate-700/80 hover:bg-slate-800 p-2 rounded-full transition shadow-lg text-sm font-bold flex items-center justify-center w-10 h-10"
              title="Close"
            >
              ✕
            </button>
            <img 
              src={lightboxImage} 
              alt="Full size view" 
              className="max-w-full max-h-[85vh] rounded-2xl border border-slate-800 shadow-2xl object-contain"
            />
          </div>
        </div>
      )}

      {/* Announcement Modal */}
      {showAnnouncementModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-amber-400" /> Push Public Announcement
              </h3>
              <button onClick={() => setShowAnnouncementModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleSendAnnouncement} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-400 font-medium">Announcement Message</label>
                <textarea
                  value={announcementText}
                  onChange={(e) => setAnnouncementText(e.target.value)}
                  placeholder="Type an important announcement broadcasted to all rooms..."
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-indigo-500 resize-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAnnouncementModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-medium bg-amber-600 text-white hover:bg-amber-500 shadow-lg shadow-amber-600/20 flex items-center gap-1.5"
                >
                  <Megaphone className="w-4 h-4" /> Push Broadcast
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Custom Room Modal */}
      {showCreateRoomModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-400" /> Create Custom Room
              </h3>
              <button onClick={() => setShowCreateRoomModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <form onSubmit={handleCreateRoomSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-400 font-medium">Room ID / Slug</label>
                <input
                  type="text"
                  value={newRoomIdInput}
                  onChange={(e) => setNewRoomIdInput(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                  placeholder="e.g. design-sprint"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-slate-400 font-medium">Room Display Name</label>
                <input
                  type="text"
                  value={newRoomNameInput}
                  onChange={(e) => setNewRoomNameInput(e.target.value)}
                  placeholder="e.g. Design Sprint Team"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="isPrivateModal"
                  checked={newRoomIsPrivate}
                  onChange={(e) => setNewRoomIsPrivate(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="isPrivateModal" className="text-sm text-slate-300 font-medium flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-400" /> Private Room (Requires Passcode)
                </label>
              </div>

              {newRoomIsPrivate && (
                <div className="space-y-1">
                  <label className="text-xs text-slate-400 font-medium">Room Passcode</label>
                  <input
                    type="password"
                    value={newRoomPasscode}
                    onChange={(e) => setNewRoomPasscode(e.target.value)}
                    placeholder="Enter secret passcode"
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
                    required={newRoomIsPrivate}
                  />
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateRoomModal(false)}
                  className="px-4 py-2 rounded-xl text-xs font-medium bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20"
                >
                  Create & Enter
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-indigo-400" /> User Preferences
              </h3>
              <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="space-y-4">
              {/* Compact Mode Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium text-white">Compact Message Mode</div>
                  <div className="text-xs text-slate-400">Reduce spacing and bubble padding for high-density reading.</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={settings.compactMode}
                    onChange={(e) => setSettings(prev => ({ ...prev, compactMode: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>

              {/* Disable Sound Effects Toggle */}
              <div className="flex items-center justify-between p-3.5 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium text-white">Disable Sound Effects</div>
                  <div className="text-xs text-slate-400">Mute all alert chimes and message notification pops.</div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={settings.disableSound}
                    onChange={(e) => setSettings(prev => ({ ...prev, disableSound: e.target.checked }))}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="px-5 py-2.5 rounded-xl text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-600/20 transition"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
