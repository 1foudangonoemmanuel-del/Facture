import { Controller, Get, Param, Post, Req } from '@nestjs/common';
import { Roles } from './auth.decorators';
import type { AuthenticatedRequest } from './auth.guard';
import { RecapService } from './recap.service';

@Controller('api/recap')
export class RecapController {
    constructor(private readonly recapService: RecapService) { }

    @Get('today')
    @Roles('ADMIN', 'MANAGER', 'CAISSE')
    getTodayRecap() {
        return this.recapService.getTodayRecap();
    }

    @Get('days')
    @Roles('ADMIN', 'MANAGER', 'CAISSE')
    listDays() {
        return this.recapService.listDays();
    }

    @Get('days/:closeId')
    @Roles('ADMIN', 'MANAGER', 'CAISSE')
    getClosedDay(@Param('closeId') closeId: string) {
        return this.recapService.getClosedDay(Number(closeId));
    }

    @Post('close-today')
    @Roles('ADMIN', 'MANAGER', 'CAISSE')
    closeToday(@Req() request: AuthenticatedRequest) {
        return this.recapService.closeToday(request.user.id);
    }
}
