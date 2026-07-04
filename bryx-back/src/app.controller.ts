import { Controller, Get } from '@nestjs/common';
import { Public } from './auth.decorators';

@Controller()
export class AppController {
  @Public()
  @Get('api/health')
  health() {
    return {
      ok: true,
      message: 'BRYX backend is running',
      date: new Date().toISOString(),
    };
  }
}
