import { pgTable, text, timestamp, boolean } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  avatar: text('avatar').notNull(),
  color: text('color').notNull(),
  isBot: boolean('is_bot').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull(),
  senderId: text('sender_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  type: text('type').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
