import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('api/health')
  health() {
    return {
      ok: true,
      message: 'BRYX backend is running',
      date: new Date().toISOString(),
    };
  }
}