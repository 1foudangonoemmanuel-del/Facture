import { Controller, Get, Param } from '@nestjs/common';
import { ActivityLogsService } from './activity-logs.service';

@Controller('api/activity-logs')
export class ActivityLogsController {
    constructor(private readonly activityLogsService: ActivityLogsService) { }

    @Get()
    findAll() {
        return this.activityLogsService.findAll();
    }

    @Get('invoice/:invoiceId')
    findByInvoice(@Param('invoiceId') invoiceId: string) {
        return this.activityLogsService.findByInvoice(Number(invoiceId));
    }

    @Get('table/:tableId')
    findByTable(@Param('tableId') tableId: string) {
        return this.activityLogsService.findByTable(Number(tableId));
    }
}