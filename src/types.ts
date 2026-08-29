export interface User {
  id: string;
  name: string;
  avatar: string;
  color: string;
}

export interface Message {
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

export interface RoomMeta {
  id: string;
  name: string;
  isPrivate: boolean;
  passcode?: string;
  createdBy: string;
  createdAt: number;
}

export interface RoomInitPayload {
  messages: Message[];
  users: User[];
  meta?: RoomMeta;
}
