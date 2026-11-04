import { z } from 'zod';
import { appLogger } from './appLogger';
import type {
  QuickUploadLink,
  ReleaseTemplateType,
  ReleaseType,
  ReleaseTypePreset,
  ProjectLinks,
  Comment,
  FixSnippetEntry,
  TrackFileEntry
} from '../types';

export const ReleaseTypeSchema = z.enum(['VOICEOVER', 'RECAST', 'REDUB']) as z.ZodType<
  ReleaseType,
  z.ZodTypeDef,
  unknown
>;

export const ReleaseTemplateTypeSchema = z.enum([
  'TG',
  'TG_ARTICLE',
  'VK',
  'FINAL_TG'
]) as z.ZodType<ReleaseTemplateType, z.ZodTypeDef, unknown>;

export const QuickUploadLinkSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    title: z.string().optional(),
    url: z.string().min(1)
  })
  .transform((val): QuickUploadLink => {
    const resolvedName = (val.name || val.title || 'Ссылка').trim();
    return {
      ...(val.id ? { id: val.id } : {}),
      name: resolvedName,
      title: val.title ? val.title.trim() : resolvedName,
      url: val.url.trim()
    };
  }) as unknown as z.ZodType<QuickUploadLink, z.ZodTypeDef, unknown>;

export const ProjectLinksSchema = z
  .object({
    tg: z.string().optional(),
    vk: z.string().optional(),
    anime365: z.string().optional(),
    shikimori: z.string().optional(),
    kodik: z.string().optional(),
    quickUploadLinks: z.array(QuickUploadLinkSchema).optional()
  })
  .catchall(z.union([z.string(), z.array(QuickUploadLinkSchema), z.undefined()])) as unknown as z.ZodType<
  ProjectLinks,
  z.ZodTypeDef,
  unknown
>;

export const ReleaseTypePresetSchema = z.object({
  releaseType: ReleaseTypeSchema,
  name: z.string().min(1),
  defaultTemplateType: ReleaseTemplateTypeSchema.default('TG'),
  tgPostTemplate: z.string(),
  tgArticleTemplate: z.string(),
  vkPostTemplate: z.string(),
  finalTgPostTemplate: z.string(),
  linksTemplate: z.string(),
  quickUploadLinks: z.array(QuickUploadLinkSchema),
  defaultPlatformLinks: z
    .object({
      tg: z.string().optional(),
      vk: z.string().optional(),
      anime365: z.string().optional(),
      shikimori: z.string().optional(),
      kodik: z.string().optional()
    })
    .catchall(z.union([z.string(), z.undefined()]))
}) as unknown as z.ZodType<ReleaseTypePreset, z.ZodTypeDef, unknown>;

export const CommentSchema = z.object({
  id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  text: z.string().default(''),
  timestamp: z.number().default(0),
  author: z.string().default('QA'),
  subId: z.string().optional()
}) as unknown as z.ZodType<Comment, z.ZodTypeDef, unknown>;

export const CommentArraySchema = z.array(CommentSchema) as unknown as z.ZodType<
  Comment[],
  z.ZodTypeDef,
  unknown
>;

export const FixSnippetSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  size: z.number().optional(),
  trackIndex: z.number().nullable().optional()
}) as unknown as z.ZodType<FixSnippetEntry, z.ZodTypeDef, unknown>;

export const TrackFileEntrySchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  path: z.string(),
  createdAt: z.string(),
  type: z.enum(['DUBBER_FILE', 'FIXES', 'SOUND_ENGINEER_FILE']).optional(),
  size: z.number().optional()
}) as unknown as z.ZodType<TrackFileEntry, z.ZodTypeDef, unknown>;

/**
 * Type-safe JSON parser with optional Zod schema validation and structured warning logs.
 * Eliminates silent `catch {}` blocks across frontend and shared helpers.
 */
export function safeJsonParse<T>(
  raw: unknown,
  fallback: T,
  context: string,
  schema?: z.ZodType<T, z.ZodTypeDef, unknown>
): T {
  if (raw === null || raw === undefined || raw === '') {
    return fallback;
  }

  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (schema) {
      const result = schema.safeParse(parsed);
      if (result.success) {
        return result.data;
      }
      appLogger.warn(
        'VALIDATION',
        `Schema validation failed in ${context}: ${result.error.issues.map((i) => i.message).join('; ')}`
      );
      return fallback;
    }
    return (parsed as T) ?? fallback;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    appLogger.warn('VALIDATION', `Failed to parse JSON in ${context}: ${msg}`);
    return fallback;
  }
}
