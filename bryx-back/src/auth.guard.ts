import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService, AuthenticatedUser } from './auth.service';
import { IS_PUBLIC_KEY, ROLES_KEY } from './auth.decorators';

@Injectable()
export class BryxAuthGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly authService: AuthService,
    ) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (isPublic) return true;

        const request = context.switchToHttp().getRequest();
        const token = this.extractBearerToken(request.headers?.authorization);

        if (!token) {
            throw new UnauthorizedException('Authentification obligatoire');
        }

        const user = await this.authService.verifyToken(token);
        request.user = user;

        const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (roles?.length && !roles.includes(user.role)) {
            throw new ForbiddenException('Permission insuffisante');
        }

        return true;
    }

    private extractBearerToken(header?: string): string | null {
        if (!header) return null;

        const [type, token] = header.split(' ');
        if (type !== 'Bearer' || !token) return null;

        return token;
    }
}

export type AuthenticatedRequest = {
    user: AuthenticatedUser;
};
