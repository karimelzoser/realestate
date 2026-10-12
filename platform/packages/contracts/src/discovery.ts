import { z } from 'zod';

export const publicProjectSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(3).max(100);
export const discoveryQuerySchema = z.object({
  q: z.string().trim().max(100).default(''),
  after: publicProjectSlugSchema.optional(),
  limit: z.coerce.number().int().min(1).max(24).default(12),
}).strict();
export type DiscoveryQuery = z.infer<typeof discoveryQuerySchema>;
export const projectPublicationScopeSchema = z.object({tenantId:z.uuid(),projectId:z.uuid()});
export const publishProjectDiscoverySchema = z.object({
  slug: publicProjectSlugSchema,
  titleEn: z.string().trim().min(2).max(180),
  titleAr: z.string().trim().min(2).max(180),
  descriptionEn: z.string().trim().min(10).max(1500),
  descriptionAr: z.string().trim().min(10).max(1500),
  locationEn: z.string().trim().min(2).max(160),
  locationAr: z.string().trim().min(2).max(160),
  status: z.enum(['PUBLISHED', 'UNPUBLISHED']),
  reason: z.string().trim().min(10).max(500),
}).strict();
export type PublishProjectDiscoveryInput = z.infer<typeof publishProjectDiscoverySchema>;
export interface PublicProject {
  slug: string;
  title: { en: string; ar: string };
  description: { en: string; ar: string };
  location: { en: string; ar: string };
}
export interface PublicProjectPage { items: PublicProject[]; nextCursor: string | null }
