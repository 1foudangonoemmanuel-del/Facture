import { Controller, Get } from '@nestjs/common';
import { RecapService } from './recap.service';

@Controller('api/recap')
export class RecapController {
    constructor(private readonly recapService: RecapService) { }

    @Get('today')
    getTodayRecap() {
        return this.recapService.getTodayRecap();
    }
}