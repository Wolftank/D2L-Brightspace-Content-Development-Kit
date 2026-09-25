import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { ContentBlock } from '../types/content.js';
import type { QaReport } from '../types/qa.js';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  displayName: text('display_name').notNull(),
  email: text('email'),
  role: text('role').notNull().default('instructor'),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  avenue: text('avenue', { enum: ['topic', 'scorm', 'widget', 'external'] }),
  sessionId: text('session_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  seq: integer('seq').notNull(),
  role: text('role', { enum: ['instructor', 'agent'] }).notNull(),
  content: text('content', { mode: 'json' }).notNull().$type<ContentBlock[]>(),
  turnId: text('turn_id'),
  createdAt: integer('created_at').notNull(),
});

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export const turns = sqliteTable('turns', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  messageId: text('message_id').notNull(),
  replyId: text('reply_id'),
  status: text('status', {
    enum: ['queued', 'running', 'completed', 'failed', 'cancelled'],
  }).notNull(),
  startedAt: integer('started_at'),
  finishedAt: integer('finished_at'),
  error: text('error', { mode: 'json' }).$type<{ code: string; message: string }>(),
  usage: text('usage', { mode: 'json' }).$type<{
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    steps?: number;
  }>(),
});

export type Turn = typeof turns.$inferSelect;
export type NewTurn = typeof turns.$inferInsert;

export const builds = sqliteTable(
  'builds',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id),
    version: integer('version').notNull(),
    status: text('status', { enum: ['checking', 'ready', 'failed'] }).notNull(),
    avenue: text('avenue', { enum: ['topic', 'scorm', 'widget', 'external'] }).notNull(),
    qa: text('qa', { mode: 'json' }).$type<QaReport>(),
    error: text('error', { mode: 'json' }).$type<{ code: string; message: string }>(),
    turnId: text('turn_id'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('builds_project_version').on(table.projectId, table.version)],
);

export type Build = typeof builds.$inferSelect;
export type NewBuild = typeof builds.$inferInsert;

export const events = sqliteTable('events', {
  seq: integer('seq').primaryKey({ autoIncrement: true }),
  projectId: text('project_id')
    .notNull()
    .references(() => projects.id),
  turnId: text('turn_id'),
  kind: text('kind').notNull(),
  payload: text('payload', { mode: 'json' }).notNull(),
  ts: integer('ts').notNull(),
});

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
