import { Controller, Get, Post, Req } from '@nestjs/common';
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

    @Post('close-today')
    @Roles('ADMIN', 'MANAGER', 'CAISSE')
    closeToday(@Req() request: AuthenticatedRequest) {
        return this.recapService.closeToday(request.user.id);
    }
}
