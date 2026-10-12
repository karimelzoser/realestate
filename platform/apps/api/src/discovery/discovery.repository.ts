import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { DiscoveryQuery, PublicProject, PublicProjectPage, PublishProjectDiscoveryInput } from '@preneura/contracts/discovery';
import { DATABASE } from '../database/database.module.js';

type Row = { slug:string;title_en:string;title_ar:string;description_en:string;description_ar:string;location_en:string;location_ar:string };
const project = (row:Row):PublicProject => ({slug:row.slug,title:{en:row.title_en,ar:row.title_ar},
  description:{en:row.description_en,ar:row.description_ar},location:{en:row.location_en,ar:row.location_ar}});
@Injectable()
export class DiscoveryRepository {
  constructor(@Inject(DATABASE) private readonly db:Kysely<Database>) {}
  async list(query:DiscoveryQuery):Promise<PublicProjectPage> {
    const rows=(await sql<Row>`SELECT pub.slug,pub.title_en,pub.title_ar,pub.description_en,pub.description_ar,pub.location_en,pub.location_ar
      FROM project_publications pub JOIN projects p ON p.id=pub.project_id AND p.tenant_id=pub.tenant_id
      JOIN tenants t ON t.id=pub.tenant_id
      WHERE pub.status='PUBLISHED' AND p.status='ACTIVE' AND t.status='ACTIVE'
      AND (${query.q}='' OR position(lower(${query.q}) in lower(pub.title_en||' '||pub.title_ar||' '||pub.location_en||' '||pub.location_ar))>0)
      AND (${query.after??null}::text IS NULL OR pub.slug>${query.after??null}::text)
      ORDER BY pub.slug LIMIT ${query.limit+1}`.execute(this.db)).rows;
    return {items:rows.slice(0,query.limit).map(project),nextCursor:rows.length>query.limit?rows[query.limit-1]!.slug:null};
  }
  async detail(slug:string):Promise<PublicProject|null> {
    const row=(await sql<Row>`SELECT pub.slug,pub.title_en,pub.title_ar,pub.description_en,pub.description_ar,pub.location_en,pub.location_ar
      FROM project_publications pub JOIN projects p ON p.id=pub.project_id AND p.tenant_id=pub.tenant_id
      JOIN tenants t ON t.id=pub.tenant_id WHERE pub.slug=${slug}
      AND pub.status='PUBLISHED' AND p.status='ACTIVE' AND t.status='ACTIVE'`.execute(this.db)).rows[0];
    return row?project(row):null;
  }
  async publish(actorUserId:string,tenantId:string,projectId:string,input:PublishProjectDiscoveryInput):Promise<void> {
    await sql`INSERT INTO project_publications(project_id,tenant_id,slug,title_en,title_ar,description_en,description_ar,
      location_en,location_ar,status,updated_by,change_reason)
      VALUES(${projectId}::uuid,${tenantId}::uuid,${input.slug},${input.titleEn},${input.titleAr},${input.descriptionEn},${input.descriptionAr},
      ${input.locationEn},${input.locationAr},${input.status},${actorUserId}::uuid,${input.reason})
      ON CONFLICT(project_id) DO UPDATE SET slug=EXCLUDED.slug,title_en=EXCLUDED.title_en,title_ar=EXCLUDED.title_ar,
      description_en=EXCLUDED.description_en,description_ar=EXCLUDED.description_ar,location_en=EXCLUDED.location_en,
      location_ar=EXCLUDED.location_ar,status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,change_reason=EXCLUDED.change_reason
      WHERE project_publications.tenant_id=EXCLUDED.tenant_id`.execute(this.db);
  }
}
