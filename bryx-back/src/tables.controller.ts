import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
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
        @Body()
        body: {
            name: string;
            responsibleUserId?: number;
            createdByUserId?: number;
        },
    ) {
        return this.tablesService.create(body);
    }

    @Patch(':id')
    update(
        @Param('id') id: string,
        @Body()
        body: {
            name?: string;
            status?: string;
            actorUserId?: number;
        },
    ) {
        return this.tablesService.update(Number(id), body);
    }

    @Patch(':id/move')
    move(
        @Param('id') id: string,
        @Body()
        body: {
            responsibleUserId: number;
            actorUserId?: number;
        },
    ) {
        return this.tablesService.move(Number(id), body);
    }
}