import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Roles } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.guard';
import { TablesService } from './tables.service';

@Controller('api/tables')
export class TablesController {
    constructor(private readonly tablesService: TablesService) { }

    @Get()
    findAll() {
        return this.tablesService.findAll();
    }

    @Get(':id')
    findOne(@Param('id') id: string) {
        return this.tablesService.findOne(Number(id));
    }

    @Post()
    create(
        @Req() request: AuthenticatedRequest,
        @Body()
        body: {
            name: string;
            responsibleUserId?: number;
        },
    ) {
        return this.tablesService.create({
            ...body,
            createdByUserId: request.user.id,
        });
    }

    @Patch(':id')
    update(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        body: {
            name?: string;
            status?: string;
        },
    ) {
        if (body.name !== undefined && !['ADMIN', 'MANAGER'].includes(request.user.role)) {
            throw new ForbiddenException('Renommer une table est réservé au manager ou à l’admin');
        }

        if (body.status !== undefined && !['ADMIN', 'MANAGER', 'CAISSE'].includes(request.user.role)) {
            throw new ForbiddenException('Fermer une table est réservé à la caisse, au manager ou à l’admin');
        }

        return this.tablesService.update(Number(id), {
            ...body,
            actorUserId: request.user.id,
        });
    }

    @Patch(':id/move')
    @Roles('ADMIN', 'MANAGER')
    move(
        @Req() request: AuthenticatedRequest,
        @Param('id') id: string,
        @Body()
        body: {
            responsibleUserId: number;
        },
    ) {
        return this.tablesService.move(Number(id), {
            ...body,
            actorUserId: request.user.id,
        });
    }
}
