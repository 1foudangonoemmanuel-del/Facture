import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from './prisma.service';

export type AuthenticatedUser = {
    id: number;
    name: string;
    role: string;
    active: boolean;
    blocked: boolean;
};

@Injectable()
export class AuthService {
    constructor(private readonly prisma: PrismaService) { }

    async login(data: { name: string; pin: string }) {
        const name = data.name?.trim();
        const pin = data.pin?.trim();

        if (!name || !pin) {
            throw new BadRequestException('Nom et code PIN obligatoires');
        }

        const user = await this.prisma.user.findFirst({
            where: {
                name: {
                    equals: name,
                },
            },
        });

        if (!user) {
            throw new UnauthorizedException('Utilisateur introuvable');
        }

        if (!user.active || user.blocked) {
            throw new UnauthorizedException('Compte bloqué ou désactivé');
        }

        if (!user.pin || user.pin !== pin) {
            throw new UnauthorizedException('Code PIN incorrect');
        }

        const authenticatedUser = {
            id: user.id,
            name: user.name,
            role: user.role,
            active: user.active,
            blocked: user.blocked,
        };

        return {
            ...authenticatedUser,
            token: this.signToken({
                sub: user.id,
                role: user.role,
                exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
            }),
        };
    }

    async verifyToken(token: string): Promise<AuthenticatedUser> {
        const payload = this.readToken(token);

        if (!payload || !payload.sub || !payload.exp) {
            throw new UnauthorizedException('Token invalide');
        }

        if (payload.exp < Math.floor(Date.now() / 1000)) {
            throw new UnauthorizedException('Session expirée');
        }

        const user = await this.prisma.user.findUnique({
            where: {
                id: Number(payload.sub),
            },
        });

        if (!user || !user.active || user.blocked) {
            throw new UnauthorizedException('Compte bloqué ou désactivé');
        }

        return {
            id: user.id,
            name: user.name,
            role: user.role,
            active: user.active,
            blocked: user.blocked,
        };
    }

    private signToken(payload: Record<string, unknown>) {
        const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
        const signature = this.sign(encodedPayload);

        return `${encodedPayload}.${signature}`;
    }

    private readToken(token: string): Record<string, any> | null {
        const [encodedPayload, signature] = token.split('.');

        if (!encodedPayload || !signature) return null;

        const expectedSignature = this.sign(encodedPayload);

        if (!this.safeEquals(signature, expectedSignature)) {
            return null;
        }

        try {
            return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
        } catch {
            return null;
        }
    }

    private sign(value: string) {
        return createHmac('sha256', this.getSecret())
            .update(value)
            .digest('base64url');
    }

    private safeEquals(left: string, right: string) {
        const leftBuffer = Buffer.from(left);
        const rightBuffer = Buffer.from(right);

        if (leftBuffer.length !== rightBuffer.length) return false;

        return timingSafeEqual(leftBuffer, rightBuffer);
    }

    private base64UrlEncode(value: string) {
        return Buffer.from(value, 'utf8').toString('base64url');
    }

    private getSecret() {
        return process.env.BRYX_AUTH_SECRET || 'bryx-dev-secret-change-me';
    }
}
