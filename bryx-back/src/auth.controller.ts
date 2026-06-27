import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('api/auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Post('login')
    login(
        @Body()
        body: {
            name: string;
            pin: string;
        },
    ) {
        return this.authService.login(body);
    }
}