import express from "express";
import http from "http";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;

app.use(express.json({ limit: "50mb" }));

// Initialize Gemini client safely
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

interface Message {
  id: string;
  room: string;
  sender: {
    id: string;
    name: string;
    avatar: string;
    color: string;
    isBot?: boolean;
  };
  content: string;
  fileName?: string;
  fileSize?: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'file' | 'code';
  timestamp: number;
  reactions?: Record<string, string[]>;
  replyTo?: {
    id: string;
    senderName: string;
    content: string;
  };
  isPinned?: boolean;
  seenBy?: string[];
  isAnnouncement?: boolean;
}

interface RoomMeta {
  id: string;
  name: string;
  isPrivate: boolean;
  passcode?: string;
  createdBy: string;
  createdAt: number;
}

interface RoomState {
  messages: Message[];
  users: Map<WebSocket, { id: string; name: string; avatar: string; color: string; room: string }>;
}

const rooms = new Map<string, RoomState>();
const roomMetas = new Map<string, RoomMeta>();

// Initialize default rooms
roomMetas.set('lobby', { id: 'lobby', name: 'General Lobby', isPrivate: false, createdBy: 'System', createdAt: Date.now() });
roomMetas.set('tech-talk', { id: 'tech-talk', name: 'Tech Talk & Code', isPrivate: false, createdBy: 'System', createdAt: Date.now() });
roomMetas.set('announcements', { id: 'announcements', name: 'Public Announcements', isPrivate: false, createdBy: 'System', createdAt: Date.now() });

function getRoom(roomId: string): RoomState {
  if (!rooms.has(roomId)) {
    const meta = roomMetas.get(roomId) || { id: roomId, name: roomId, isPrivate: false, createdBy: 'System', createdAt: Date.now() };
    roomMetas.set(roomId, meta);

    rooms.set(roomId, {
      messages: [
        {
          id: 'welcome-' + Date.now(),
          room: roomId,
          sender: { id: 'system', name: 'PulseBot', avatar: '🤖', color: '#6366f1', isBot: true },
          content: `Welcome to room **#${roomId}**! This is a passwordless, secure, real-time chat room supporting rich media (images, videos, documents, audio). Share this room code or invite link with friends. Type \`@ai\` to ask Gemini anything!`,
          type: 'text',
          timestamp: Date.now()
        }
      ],
      users: new Map()
    });
  }
  return rooms.get(roomId)!;
}

wss.on("connection", (ws) => {
  let currentRoom: string | null = null;
  let currentUser: { id: string; name: string; avatar: string; color: string } | null = null;

  ws.on("message", async (data) => {
    try {
      const packet = JSON.parse(data.toString());
      const { type, payload } = packet;

      if (type === 'create_room') {
        const { roomId, name, isPrivate, passcode, user } = payload;
        const cleanId = roomId.toLowerCase().replace(/[^a-z0-9-_]/g, '');
        if (!cleanId) return;

        roomMetas.set(cleanId, {
          id: cleanId,
          name: name || cleanId,
          isPrivate: !!isPrivate,
          passcode: passcode || undefined,
          createdBy: user.name,
          createdAt: Date.now()
        });

        ws.send(JSON.stringify({
          type: 'room_created',
          payload: { roomId: cleanId }
        }));
      }

      else if (type === 'join') {
        const { roomId, passcode, user } = payload;
        const cleanId = roomId.toLowerCase().replace(/[^a-z0-9-_]/g, '');
        
        const meta = roomMetas.get(cleanId);
        if (meta && meta.isPrivate && meta.passcode && meta.passcode !== passcode) {
          ws.send(JSON.stringify({
            type: 'error',
            payload: { message: 'Incorrect passcode for this private room.' }
          }));
          return;
        }

        currentRoom = cleanId;
        currentUser = user;

        const room = getRoom(cleanId);
        room.users.set(ws, { ...user, room: cleanId });

        ws.send(JSON.stringify({
          type: 'room_init',
          payload: {
            messages: room.messages,
            users: Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name, avatar: u.avatar, color: u.color })),
            meta: roomMetas.get(cleanId)
          }
        }));

        broadcastToRoom(cleanId, {
          type: 'user_joined',
          payload: {
            user,
            users: Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name, avatar: u.avatar, color: u.color }))
          }
        }, ws);
      }

      else if (type === 'message' && currentRoom && currentUser) {
        const room = getRoom(currentRoom);
        const newMsg: Message = {
          id: 'msg_' + Math.random().toString(36).substring(2, 9) + Date.now(),
          room: currentRoom,
          sender: currentUser,
          content: payload.content,
          fileName: payload.fileName,
          fileSize: payload.fileSize,
          type: payload.type || 'text',
          timestamp: Date.now(),
          replyTo: payload.replyTo,
          isAnnouncement: payload.isAnnouncement
        };

        room.messages.push(newMsg);
        if (room.messages.length > 200) room.messages.shift();

        broadcastToRoom(currentRoom, {
          type: 'new_message',
          payload: newMsg
        });

        // If it's a global announcement, broadcast to ALL active rooms
        if (payload.isAnnouncement) {
          rooms.forEach((rState, rId) => {
            if (rId !== currentRoom) {
              rState.messages.push(newMsg);
              broadcastToRoom(rId, {
                type: 'new_message',
                payload: newMsg
              });
            }
          });
        }

        // AI mention check
        if (payload.content.toLowerCase().includes('@ai') || payload.content.toLowerCase().includes('@bot')) {
          const promptQuery = payload.content.replace(/@ai|@bot/gi, '').trim();
          if (promptQuery) {
            try {
              const aiSender = { id: 'ai_bot', name: 'Gemini AI', avatar: '✨', color: '#8b5cf6', isBot: true };
              
              broadcastToRoom(currentRoom, {
                type: 'typing',
                payload: { user: aiSender, isTyping: true }
              });

              const response = await ai.models.generateContent({
                model: 'gemini-3.7-flash',
                contents: promptQuery,
                config: {
                  systemInstruction: "You are PulseBot, a helpful, witty, and concise AI assistant inside a real-time group chat. Keep responses engaging, formatted nicely with markdown if helpful, and friendly."
                }
              });

              const aiMsg: Message = {
                id: 'msg_ai_' + Date.now(),
                room: currentRoom,
                sender: aiSender,
                content: response.text || "I'm here to help!",
                type: 'text',
                timestamp: Date.now()
              };

              room.messages.push(aiMsg);
              
              broadcastToRoom(currentRoom, {
                type: 'typing',
                payload: { user: aiSender, isTyping: false }
              });

              broadcastToRoom(currentRoom, {
                type: 'new_message',
                payload: aiMsg
              });
            } catch (err) {
              console.error("AI response error:", err);
              broadcastToRoom(currentRoom, {
                type: 'typing',
                payload: { user: { id: 'ai_bot', name: 'Gemini AI' }, isTyping: false }
              });
            }
          }
        }
      }

      else if (type === 'typing' && currentRoom && currentUser) {
        broadcastToRoom(currentRoom, {
          type: 'typing',
          payload: { user: currentUser, isTyping: payload.isTyping }
        }, ws);
      }

      else if (type === 'reaction' && currentRoom && currentUser) {
        const room = getRoom(currentRoom);
        const msg = room.messages.find(m => m.id === payload.messageId);
        if (msg) {
          if (!msg.reactions) msg.reactions = {};
          const emoji = payload.emoji;
          if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
          
          const idx = msg.reactions[emoji].indexOf(currentUser.name);
          if (idx >= 0) {
            msg.reactions[emoji].splice(idx, 1);
            if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
          } else {
            msg.reactions[emoji].push(currentUser.name);
          }

          broadcastToRoom(currentRoom, {
            type: 'reaction_update',
            payload: { messageId: msg.id, reactions: msg.reactions }
          });
        }
      }

      else if (type === 'pin' && currentRoom && currentUser) {
        const room = getRoom(currentRoom);
        const msg = room.messages.find(m => m.id === payload.messageId);
        if (msg) {
          msg.isPinned = !msg.isPinned;
          broadcastToRoom(currentRoom, {
            type: 'pin_update',
            payload: { messageId: msg.id, isPinned: msg.isPinned }
          });
        }
      }

      else if (type === 'mark_seen' && currentRoom && currentUser) {
        const room = getRoom(currentRoom);
        room.messages.forEach(msg => {
          if (msg.sender.id !== currentUser!.id) {
            if (!msg.seenBy) msg.seenBy = [];
            if (!msg.seenBy.includes(currentUser!.id)) {
              msg.seenBy.push(currentUser!.id);
            }
          }
        });
        broadcastToRoom(currentRoom, {
          type: 'read_receipt_update',
          payload: { userId: currentUser.id, messages: room.messages.map(m => ({ id: m.id, seenBy: m.seenBy })) }
        });
      }

    } catch (e) {
      console.error("WS message error:", e);
    }
  });

  ws.on("close", () => {
    if (currentRoom && currentUser) {
      const room = rooms.get(currentRoom);
      if (room) {
        room.users.delete(ws);
        broadcastToRoom(currentRoom, {
          type: 'user_left',
          payload: {
            user: currentUser,
            users: Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name, avatar: u.avatar, color: u.color }))
          }
        });
      }
    }
  });
});

function broadcastToRoom(roomId: string, packet: any, excludeWs?: WebSocket) {
  const room = rooms.get(roomId);
  if (!room) return;
  const dataStr = JSON.stringify(packet);
  room.users.forEach((_, clientWs) => {
    if (clientWs !== excludeWs && clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(dataStr);
    }
  });
}

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", activeRooms: rooms.size, roomsList: Array.from(roomMetas.values()) });
});

app.post("/api/room/create", (req, res) => {
  const { roomId, name, isPrivate, passcode, user } = req.body;
  const cleanId = (roomId || '').toLowerCase().replace(/[^a-z0-9-_]/g, '');
  if (!cleanId) {
    return res.status(400).json({ error: "Invalid room ID" });
  }

  roomMetas.set(cleanId, {
    id: cleanId,
    name: name || cleanId,
    isPrivate: !!isPrivate,
    passcode: passcode || undefined,
    createdBy: user?.name || 'Anonymous',
    createdAt: Date.now()
  });

  const room = getRoom(cleanId);
  res.json({ success: true, roomId: cleanId, meta: roomMetas.get(cleanId) });
});

app.get("/api/room/:roomId", (req, res) => {
  const roomId = req.params.roomId.toLowerCase().replace(/[^a-z0-9-_]/g, '');
  const room = getRoom(roomId);
  const meta = roomMetas.get(roomId);
  res.json({
    messages: room.messages,
    users: Array.from(room.users.values()).map(u => ({ id: u.id, name: u.name, avatar: u.avatar, color: u.color })),
    meta
  });
});

app.post("/api/room/:roomId/message", async (req, res) => {
  const roomId = req.params.roomId.toLowerCase().replace(/[^a-z0-9-_]/g, '');
  const { user, content, type, fileName, fileSize, replyTo, isAnnouncement } = req.body;
  if (!user || !content) {
    return res.status(400).json({ error: "Missing user or content" });
  }

  const room = getRoom(roomId);
  const newMsg: Message = {
    id: 'msg_' + Math.random().toString(36).substring(2, 9) + Date.now(),
    room: roomId,
    sender: user,
    content,
    fileName,
    fileSize,
    type: type || 'text',
    timestamp: Date.now(),
    replyTo,
    isAnnouncement
  };

  room.messages.push(newMsg);
  if (room.messages.length > 200) room.messages.shift();

  broadcastToRoom(roomId, {
    type: 'new_message',
    payload: newMsg
  });

  if (isAnnouncement) {
    rooms.forEach((rState, rId) => {
      if (rId !== roomId) {
        rState.messages.push(newMsg);
        broadcastToRoom(rId, {
          type: 'new_message',
          payload: newMsg
        });
      }
    });
  }

  // AI mention check
  if (content.toLowerCase().includes('@ai') || content.toLowerCase().includes('@bot')) {
    const promptQuery = content.replace(/@ai|@bot/gi, '').trim();
    if (promptQuery) {
      try {
        const aiSender = { id: 'ai_bot', name: 'Gemini AI', avatar: '✨', color: '#8b5cf6', isBot: true };
        broadcastToRoom(roomId, { type: 'typing', payload: { user: aiSender, isTyping: true } });

        const response = await ai.models.generateContent({
          model: 'gemini-3.7-flash',
          contents: promptQuery,
          config: {
            systemInstruction: "You are PulseBot, a helpful, witty, and concise AI assistant inside a real-time group chat. Keep responses engaging, formatted nicely with markdown if helpful, and friendly."
          }
        });

        const aiMsg: Message = {
          id: 'msg_ai_' + Date.now(),
          room: roomId,
          sender: aiSender,
          content: response.text || "I'm here to help!",
          type: 'text',
          timestamp: Date.now()
        };

        room.messages.push(aiMsg);
        broadcastToRoom(roomId, { type: 'typing', payload: { user: aiSender, isTyping: false } });
        broadcastToRoom(roomId, { type: 'new_message', payload: aiMsg });
      } catch (err) {
        console.error("AI response error:", err);
      }
    }
  }

  res.json({ success: true, message: newMsg });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`PulseChat Server running on http://localhost:${PORT}`);
  });
}

startServer();
