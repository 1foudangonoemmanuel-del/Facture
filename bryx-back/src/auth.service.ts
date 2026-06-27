import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

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

        return {
            id: user.id,
            name: user.name,
            role: user.role,
            active: user.active,
            blocked: user.blocked,
        };
    }
}