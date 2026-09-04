import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  name: text('name').notNull(),
  hostToken: text('host_token').notNull(),
  trackKey: text('track_key').notNull(),
  trackName: text('track_name').notNull(),
  trackType: text('track_type').notNull(),
  trackSize: integer('track_size').notNull(),
  duration: real('duration').notNull().default(0),
  isPlaying: integer('is_playing', { mode: 'boolean' }).notNull().default(false),
  position: real('position').notNull().default(0),
  positionUpdatedAt: integer('position_updated_at').notNull(),
  version: integer('version').notNull().default(0),
  hostOnly: integer('host_only', { mode: 'boolean' }).notNull().default(true),
  reactionsEnabled: integer('reactions_enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [index('idx_rooms_expires_at').on(table.expiresAt)]);

export const members = sqliteTable('members', {
  roomCode: text('room_code').notNull().references(() => rooms.code, { onDelete: 'cascade' }),
  id: text('id').notNull(),
  displayName: text('display_name').notNull(),
  isHost: integer('is_host', { mode: 'boolean' }).notNull().default(false),
  lastSeen: integer('last_seen').notNull(),
}, (table) => [
  primaryKey({ columns: [table.roomCode, table.id] }),
  index('idx_members_room_seen').on(table.roomCode, table.lastSeen),
]);

export const reactions = sqliteTable('reactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roomCode: text('room_code').notNull().references(() => rooms.code, { onDelete: 'cascade' }),
  memberName: text('member_name').notNull(),
  emoji: text('emoji').notNull(),
  createdAt: integer('created_at').notNull(),
}, (table) => [index('idx_reactions_room_created').on(table.roomCode, table.createdAt)]);

export const userSessions = sqliteTable('user_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  googleSub: text('google_sub').notNull(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  picture: text('picture'),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (table) => [
  index('idx_user_sessions_google_sub').on(table.googleSub),
  index('idx_user_sessions_expires_at').on(table.expiresAt),
]);
