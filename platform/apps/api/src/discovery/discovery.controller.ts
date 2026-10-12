import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Put, Query, UseGuards } from '@nestjs/common';
import { discoveryQuerySchema, publicProjectSlugSchema, publishProjectDiscoverySchema, projectPublicationScopeSchema } from '@preneura/contracts/discovery';
import type { ResolvedSession } from '../auth/auth.repository.js';
import { CurrentSession, SessionAuthGuard } from '../auth/session-auth.guard.js';
import { AccessService } from '../access/access.service.js';
import { DiscoveryRepository } from './discovery.repository.js';

@Controller('public/projects')
export class DiscoveryController {
  constructor(private readonly repository:DiscoveryRepository) {}
  @Get()
  list(@Query() query:unknown) {
    const parsed=discoveryQuerySchema.safeParse(query);
    if(!parsed.success)throw new BadRequestException('Invalid discovery filters.');
    return this.repository.list(parsed.data);
  }
  @Get(':slug')
  async detail(@Param('slug') slug:string) {
    if(!publicProjectSlugSchema.safeParse(slug).success)throw new NotFoundException('Project not found.');
    const result=await this.repository.detail(slug);
    if(!result)throw new NotFoundException('Project not found.');
    return result;
  }
}
@UseGuards(SessionAuthGuard)
@Controller('tenants/:tenantId/projects/:projectId/publication')
export class ProjectPublicationController {
  constructor(private readonly repository:DiscoveryRepository,private readonly access:AccessService) {}
  @Put()
  async publish(@Param('tenantId') tenantId:string,@Param('projectId') projectId:string,@Body() body:unknown,@CurrentSession() session:ResolvedSession) {
    const parsed=publishProjectDiscoverySchema.safeParse(body);
    if(!parsed.success||!projectPublicationScopeSchema.safeParse({tenantId,projectId}).success)throw new BadRequestException('Invalid publication.');
    await this.access.assert({userId:session.userId,permission:'project.manage',context:{tenantId,projectId}});
    await this.repository.publish(session.userId,tenantId,projectId,parsed.data);
    return {recorded:true};
  }
}
