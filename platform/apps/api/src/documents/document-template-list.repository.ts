import { Inject, Injectable } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '@preneura/database';
import type { DocumentTemplateSnapshot } from '@preneura/contracts/documents';
import { DATABASE } from '../database/database.module.js';

@Injectable()
export class DocumentTemplateListRepository {
  constructor(@Inject(DATABASE) private readonly db: Kysely<Database>) {}

  async list(input: {
    tenantId: string;
    projectId: string;
  }): Promise<DocumentTemplateSnapshot[]> {
    const templates = await this.db
      .selectFrom('document_templates')
      .select([
        'id',
        'project_id',
        'code',
        'name',
        'category',
        'version_number',
        'status',
        'mime_type',
        'requires_signature',
        'activated_at',
        'created_at',
      ])
      .where('tenant_id', '=', input.tenantId)
      .where((eb) => eb.or([
        eb('project_id', '=', input.projectId),
        eb('project_id', 'is', null),
      ]))
      .orderBy('code', 'asc')
      .orderBy('project_id', 'desc')
      .orderBy('version_number', 'desc')
      .execute();

    if (templates.length === 0) return [];

    const signerRequirements = await this.db
      .selectFrom('document_template_signer_requirements')
      .select(['template_id', 'signer_role', 'signing_order', 'required'])
      .where('template_id', 'in', templates.map((template) => template.id))
      .orderBy('signing_order', 'asc')
      .orderBy('signer_role', 'asc')
      .execute();

    return templates.map((template) => ({
      templateId: template.id,
      scope: template.project_id ? 'PROJECT' : 'TENANT_DEFAULT',
      projectId: template.project_id,
      code: template.code,
      name: template.name,
      category: template.category,
      versionNumber: template.version_number,
      status: template.status,
      mimeType: template.mime_type,
      requiresSignature: template.requires_signature,
      activatedAt: template.activated_at ? (template.activated_at as Date).toISOString() : null,
      createdAt: (template.created_at as Date).toISOString(),
      signerRequirements: signerRequirements
        .filter((requirement) => requirement.template_id === template.id)
        .map((requirement) => ({
          signerRole: requirement.signer_role,
          signingOrder: requirement.signing_order,
          required: requirement.required,
        })),
    }));
  }
}
