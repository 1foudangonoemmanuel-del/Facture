import { Controller, Get } from '@nestjs/common';
import { Roles } from './auth.decorators';
import { RecapService } from './recap.service';

@Controller('api/recap')
export class RecapController {
    constructor(private readonly recapService: RecapService) { }

    @Get('today')
    @Roles('ADMIN', 'MANAGER', 'CAISSE')
    getTodayRecap() {
        return this.recapService.getTodayRecap();
    }
}
