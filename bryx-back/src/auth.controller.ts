import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public } from './auth.decorators';

@Controller('api/auth')
export class AuthController {
    constructor(private readonly authService: AuthService) { }

    @Public()
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
